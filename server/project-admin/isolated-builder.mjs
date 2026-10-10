import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

export const BUILDER_PROTOCOL_VERSION = 1;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MARKDOWN_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.md$/u;
const NONCE_RE = /^[0-9a-f]{64}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const MAX_CONTROL_LINE = 16 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_DIAGNOSTIC_BYTES = 32 * 1024;
const MAX_OPERATIONAL_DIAGNOSTIC_CHARS = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const SOURCE_FILE_NAMES = new Set([
  "astro.config.js",
  "astro.config.mjs",
  "astro.config.ts",
  "package.json",
  "postcss.config.js",
  "postcss.config.cjs",
  "postcss.config.mjs",
  "tailwind.config.js",
  "tailwind.config.mjs",
  "tailwind.config.ts",
  "tsconfig.json",
]);
const SOURCE_DIRECTORY_NAMES = new Set(["public", "src"]);

function normalizeCase(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}

function assertExactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label} contains an unknown field.`);
}

function safeRelativePath(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 512 ||
    value.includes("\\") ||
    value.includes("\0") ||
    path.posix.isAbsolute(value)
  ) {
    throw new Error("Builder returned an invalid path.");
  }
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error("Builder returned an invalid path.");
  return parts;
}

async function prepareRealDirectory(input, label, { create = false, mode = 0o700 } = {}) {
  if (!input || !path.isAbsolute(input)) throw new Error(`${label} must be an absolute path.`);
  const resolved = path.resolve(input);
  if (create) await fsp.mkdir(resolved, { recursive: true, mode });
  const info = await fsp.lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} must be a real directory.`);
  const real = await fsp.realpath(resolved);
  if (normalizeCase(real) !== normalizeCase(resolved)) throw new Error(`${label} may not traverse links.`);
  return real;
}

async function readBoundedFile(file, limit) {
  const info = await fsp.lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error("Builder control file is invalid.");
  return fsp.readFile(file);
}

async function hashRegularFile(file, limit) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  const handle = await fsp.open(file, flags);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > limit) throw new Error("Builder file is invalid or too large.");
    const hash = crypto.createHash("sha256");
    let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.length;
      if (size > limit) throw new Error("Builder file is too large.");
      hash.update(chunk);
    }
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || size !== before.size) {
      throw new Error("Builder file changed while hashing.");
    }
    return { size, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

async function writeAll(socket, chunk) {
  if (socket.write(chunk)) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off("drain", drained);
      socket.off("error", failed);
    };
    const drained = () => { cleanup(); resolve(); };
    const failed = (error) => { cleanup(); reject(error); };
    socket.once("drain", drained);
    socket.once("error", failed);
  });
}

async function writeLine(socket, value) {
  const serialized = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(serialized) > MAX_CONTROL_LINE) throw new Error("Builder control message is too large.");
  await writeAll(socket, serialized);
}

async function writeHandleAll(handle, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset, null);
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten < 1) throw new Error("File write ended before the buffer was complete.");
    offset += bytesWritten;
  }
}

class SocketReader {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.ended = false;
    this.failure = null;
    this.waiters = [];
    socket.on("data", (chunk) => {
      socket.pause();
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.#wake();
    });
    socket.on("end", () => {
      this.ended = true;
      this.#wake();
    });
    socket.on("error", (error) => {
      this.failure = error;
      this.#wake();
    });
    socket.pause();
  }

  #wake() {
    for (const waiter of this.waiters.splice(0)) waiter();
  }

  async #more() {
    if (this.failure) throw this.failure;
    if (this.ended) throw new Error("Builder connection ended early.");
    this.socket.resume();
    await new Promise((resolve) => this.waiters.push(resolve));
  }

  async line(limit = MAX_CONTROL_LINE) {
    while (true) {
      const newline = this.buffer.indexOf(0x0a);
      if (newline !== -1) {
        if (newline > limit) throw new Error("Builder control message is too large.");
        const line = this.buffer.subarray(0, newline).toString("utf8");
        this.buffer = this.buffer.subarray(newline + 1);
        return line;
      }
      if (this.buffer.length > limit) throw new Error("Builder control message is too large.");
      await this.#more();
    }
  }

  async exact(size, onChunk) {
    let remaining = size;
    while (remaining > 0) {
      if (!this.buffer.length) await this.#more();
      const length = Math.min(remaining, this.buffer.length);
      const chunk = this.buffer.subarray(0, length);
      this.buffer = this.buffer.subarray(length);
      remaining -= length;
      await onChunk(chunk);
    }
  }
}

function parseControl(line, label) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  assertPlainObject(value, label);
  return value;
}

async function copyRegularFile(source, destination, mode = 0o440) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  const input = await fsp.open(source, flags);
  try {
    const before = await input.stat();
    if (!before.isFile()) throw new Error("Only regular files may cross the builder boundary.");
    const output = await fsp.open(destination, "wx", mode);
    try {
      const hash = crypto.createHash("sha256");
      let bytes = 0;
      const stream = input.createReadStream({ autoClose: false });
      for await (const chunk of stream) {
        bytes += chunk.length;
        hash.update(chunk);
        await writeHandleAll(output, chunk);
      }
      const after = await input.stat();
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || bytes !== before.size) {
        throw new Error("Input changed while crossing the builder boundary.");
      }
      await output.sync();
      const written = await output.stat();
      if (!written.isFile() || written.size !== bytes) throw new Error("Copied file size does not match its input.");
      return { size: bytes, sha256: hash.digest("hex") };
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
}

async function inspectOwnedRequestDirectory(directory, expectedParent, label) {
  if (path.dirname(directory) !== expectedParent) throw new Error(`${label} is not a direct request child.`);
  const info = await fsp.lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} is unsafe.`);
  const real = await fsp.realpath(directory);
  if (normalizeCase(real) !== normalizeCase(directory)) throw new Error(`${label} may not traverse links.`);
  if (process.platform !== "win32" && typeof process.getuid === "function" && info.uid !== process.getuid()) {
    throw new Error(`${label} is not owned by the admin process.`);
  }
  return info;
}

async function thawOwnedRequestDirectory(directory, expectedInfo, label) {
  if (process.platform === "win32") return;
  const flags = fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0) | (fs.constants.O_NOFOLLOW ?? 0);
  const handle = await fsp.open(directory, flags);
  try {
    const current = await handle.stat();
    if (
      !current.isDirectory() ||
      current.dev !== expectedInfo.dev ||
      current.ino !== expectedInfo.ino ||
      (typeof process.getuid === "function" && current.uid !== process.getuid())
    ) {
      throw new Error(`${label} changed before cleanup.`);
    }
    await handle.chmod(0o700);
  } finally {
    await handle.close();
  }
}

async function removePreparedRequest(requestRoot, request, { complete = true } = {}) {
  if (!request || !UUID_RE.test(request.jobId ?? "")) throw new Error("Builder cleanup request ID is invalid.");
  const jobDir = path.join(requestRoot, request.jobId);
  if (typeof request.jobDir !== "string" || normalizeCase(request.jobDir) !== normalizeCase(jobDir) || path.dirname(jobDir) !== requestRoot) {
    throw new Error("Builder cleanup path is invalid.");
  }
  const jobInfo = await fsp.lstat(jobDir).catch((error) => {
    if (error?.code === "ENOENT" && !complete) return null;
    throw error;
  });
  if (!jobInfo) return;
  const checkedJob = await inspectOwnedRequestDirectory(jobDir, requestRoot, "Builder request directory");
  const names = (await fsp.readdir(jobDir)).sort();
  if (names.some((name) => name !== "content" && name !== "manifest.json")) {
    throw new Error("Builder request directory contains an unexpected entry.");
  }
  if (complete && JSON.stringify(names) !== JSON.stringify(["content", "manifest.json"])) {
    throw new Error("Builder request directory is incomplete during cleanup.");
  }
  const contentDir = path.join(jobDir, "content");
  const contentEntry = await fsp.lstat(contentDir).catch((error) => {
    if (error?.code === "ENOENT" && !complete) return null;
    throw error;
  });
  let checkedContent = null;
  if (contentEntry) {
    checkedContent = await inspectOwnedRequestDirectory(contentDir, jobDir, "Builder request content directory");
    for (const name of await fsp.readdir(contentDir)) {
      if (!MARKDOWN_RE.test(name)) throw new Error("Builder request content contains an unexpected entry.");
      const info = await fsp.lstat(path.join(contentDir, name));
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Builder request content entry is unsafe.");
    }
  }
  const manifest = await fsp.lstat(path.join(jobDir, "manifest.json")).catch((error) => {
    if (error?.code === "ENOENT" && !complete) return null;
    throw error;
  });
  if (manifest && (!manifest.isFile() || manifest.isSymbolicLink())) throw new Error("Builder request manifest is unsafe.");
  if (checkedContent) await thawOwnedRequestDirectory(contentDir, checkedContent, "Builder request content directory");
  await thawOwnedRequestDirectory(jobDir, checkedJob, "Builder request directory");
  await fsp.rm(jobDir, { recursive: true, force: true });
}

async function prepareRequest(requestRoot, clientProjectsDir) {
  const jobId = crypto.randomUUID();
  const nonce = crypto.randomBytes(32).toString("hex");
  const jobDir = path.join(requestRoot, jobId);
  const contentDir = path.join(jobDir, "content");
  try {
    await fsp.mkdir(contentDir, { recursive: true, mode: 0o750 });
    const entries = await fsp.readdir(clientProjectsDir, { withFileTypes: true });
    const files = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || entry.isSymbolicLink() || !MARKDOWN_RE.test(entry.name)) {
        throw new Error("Only UUID-named project Markdown files may be sent to the builder.");
      }
      const copied = await copyRegularFile(path.join(clientProjectsDir, entry.name), path.join(contentDir, entry.name));
      files.push({ name: entry.name, ...copied });
    }
    const manifest = { version: BUILDER_PROTOCOL_VERSION, jobId, nonce, files };
    const serialized = `${JSON.stringify(manifest)}\n`;
    if (Buffer.byteLength(serialized) > MAX_MANIFEST_BYTES) throw new Error("Builder request manifest is too large.");
    const manifestPath = path.join(jobDir, "manifest.json");
    await fsp.writeFile(manifestPath, serialized, { flag: "wx", mode: 0o440 });
    if (process.platform !== "win32") {
      await fsp.chmod(contentDir, 0o550);
      await fsp.chmod(jobDir, 0o550);
    }
    return { jobId, nonce, jobDir };
  } catch (error) {
    try {
      await removePreparedRequest(requestRoot, { jobId, jobDir }, { complete: false });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Builder request preparation and cleanup failed.");
    }
    throw error;
  }
}

function connectSocket(socketPath, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const timer = setTimeout(() => socket.destroy(new Error("Isolated builder connection timed out.")), timeoutMs);
    timer.unref();
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function prepareListenSocket(socketPath) {
  if (process.platform === "win32") return;
  const parent = await prepareRealDirectory(path.dirname(socketPath), "LBI_BUILDER_SOCKET parent");
  if (!isWithin(parent, socketPath) || path.dirname(socketPath) !== parent) throw new Error("Builder socket path is unsafe.");
  const existing = await fsp.lstat(socketPath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!existing) return;
  if (!existing.isSocket() || existing.isSymbolicLink()) throw new Error("Builder socket path is occupied by an unsafe file.");
  const active = await new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", (error) => resolve(error?.code !== "ECONNREFUSED"));
  });
  if (active) throw new Error("Builder socket is already active or cannot be safely replaced.");
  await fsp.unlink(socketPath);
}

export function createIsolatedBuildRunner({ socketPath, requestRoot, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!socketPath || typeof socketPath !== "string") throw new Error("Builder socket path is required.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 15 * 60 * 1000) {
    throw new Error("Builder timeout is invalid.");
  }
  return async function isolatedBuildRunner({ outDir, clientProjectsDir, maxOutputBytes, maxOutputFiles }) {
    const safeRequestRoot = await prepareRealDirectory(requestRoot, "LBI_ADMIN_BUILDER_REQUEST_DIR");
    const safeOut = path.resolve(outDir);
    await fsp.mkdir(safeOut, { recursive: true, mode: 0o700 });
    if ((await fsp.readdir(safeOut)).length) throw new Error("Isolated builder output directory must start empty.");
    const request = await prepareRequest(safeRequestRoot, clientProjectsDir);
    let socket;
    const timer = setTimeout(() => socket?.destroy(new Error("Isolated builder timed out.")), timeoutMs);
    timer.unref();
    try {
      socket = await connectSocket(socketPath, timeoutMs);
      const reader = new SocketReader(socket);
      await writeLine(socket, {
        version: BUILDER_PROTOCOL_VERSION,
        action: "build",
        jobId: request.jobId,
        nonce: request.nonce,
      });
      const response = parseControl(await reader.line(), "Builder response");
      assertExactKeys(response, ["version", "ok", "jobId", "nonce", "files", "totalBytes", "code", "message"], "Builder response");
      if (
        response.version !== BUILDER_PROTOCOL_VERSION ||
        response.jobId !== request.jobId ||
        response.nonce !== request.nonce
      ) {
        throw new Error("Builder response identity is invalid.");
      }
      if (response.ok !== true) throw new Error(`Isolated builder failed: ${String(response.message || response.code || "unknown error")}`);
      if (
        !Number.isSafeInteger(response.files) ||
        response.files < 1 ||
        response.files > maxOutputFiles ||
        !Number.isSafeInteger(response.totalBytes) ||
        response.totalBytes < 1 ||
        response.totalBytes > maxOutputBytes
      ) {
        throw new Error("Builder output exceeds the configured quota.");
      }
      let receivedFiles = 0;
      let receivedBytes = 0;
      const seen = new Set();
      while (receivedFiles < response.files) {
        const header = parseControl(await reader.line(), "Builder file header");
        assertExactKeys(header, ["path", "size", "sha256"], "Builder file header");
        const parts = safeRelativePath(header.path);
        if (seen.has(header.path)) throw new Error("Builder returned a duplicate path.");
        seen.add(header.path);
        if (!Number.isSafeInteger(header.size) || header.size < 0 || !SHA256_RE.test(header.sha256)) {
          throw new Error("Builder file header is invalid.");
        }
        receivedBytes += header.size;
        if (receivedBytes > maxOutputBytes) throw new Error("Builder output exceeds the configured quota.");
        const destination = path.join(safeOut, ...parts);
        if (!isWithin(safeOut, destination)) throw new Error("Builder output path escapes staging.");
        await fsp.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
        const output = await fsp.open(destination, "wx", 0o600);
        const hash = crypto.createHash("sha256");
        try {
          await reader.exact(header.size, async (chunk) => {
            hash.update(chunk);
            await writeHandleAll(output, chunk);
          });
          await output.sync();
          const written = await output.stat();
          if (!written.isFile() || written.size !== header.size) throw new Error("Builder output file is incomplete.");
        } finally {
          await output.close();
        }
        if (hash.digest("hex") !== header.sha256) throw new Error("Builder output hash mismatch.");
        receivedFiles += 1;
      }
      const end = parseControl(await reader.line(), "Builder completion");
      if (Object.keys(end).length !== 1 || end.end !== true || receivedBytes !== response.totalBytes) {
        throw new Error("Builder output is incomplete.");
      }
      socket.end();
      return { code: 0, stdout: "", stderr: "" };
    } finally {
      clearTimeout(timer);
      socket?.destroy();
      await removePreparedRequest(safeRequestRoot, request);
    }
  };
}

async function copySourceEntry(source, destination, budget) {
  const info = await fsp.lstat(source);
  if (info.isSymbolicLink()) throw new Error("Builder source tree contains a symbolic link.");
  if (info.isDirectory()) {
    budget.directories += 1;
    if (budget.directories > budget.maxDirectories) throw new Error("Builder source directory quota exceeded.");
    await fsp.mkdir(destination, { mode: 0o700 });
    for (const entry of await fsp.readdir(source)) await copySourceEntry(path.join(source, entry), path.join(destination, entry), budget);
    return;
  }
  if (!info.isFile()) throw new Error("Builder source tree contains a special file.");
  budget.files += 1;
  budget.bytes += info.size;
  if (budget.files > budget.maxFiles || budget.bytes > budget.maxBytes) throw new Error("Builder source quota exceeded.");
  await copyRegularFile(source, destination, 0o600);
}

async function copyFixedSource(sourceDir, workspace, sourceLimits, linkNodeModules) {
  for (const entry of await fsp.readdir(sourceDir, { withFileTypes: true })) {
    if (!SOURCE_FILE_NAMES.has(entry.name) && !SOURCE_DIRECTORY_NAMES.has(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new Error("Builder source allowlist contains a symbolic link.");
    await copySourceEntry(path.join(sourceDir, entry.name), path.join(workspace, entry.name), sourceLimits);
  }
  for (const required of ["package.json", "astro.config.ts", "src", "public"]) {
    const found = await fsp.lstat(path.join(workspace, required)).catch(() => null);
    if (!found) throw new Error(`Builder source is missing ${required}.`);
  }
  const modules = path.join(sourceDir, "node_modules");
  const modulesInfo = await fsp.lstat(modules);
  if (!modulesInfo.isDirectory() || modulesInfo.isSymbolicLink()) throw new Error("Builder node_modules is unsafe.");
  if (linkNodeModules) {
    await fsp.symlink(modules, path.join(workspace, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  } else {
    await fsp.mkdir(path.join(workspace, "node_modules"), { mode: 0o700 });
  }
}

async function validateAndCopyRequest(requestRoot, workspace, requested) {
  const jobDir = path.join(requestRoot, requested.jobId);
  if (!isWithin(requestRoot, jobDir)) throw new Error("Builder request path is invalid.");
  const jobInfo = await fsp.lstat(jobDir);
  if (!jobInfo.isDirectory() || jobInfo.isSymbolicLink()) throw new Error("Builder request directory is unsafe.");
  const jobReal = await fsp.realpath(jobDir);
  if (!isWithin(requestRoot, jobReal) || normalizeCase(jobReal) !== normalizeCase(jobDir)) {
    throw new Error("Builder request directory escapes its root.");
  }
  const manifestBuffer = await readBoundedFile(path.join(jobDir, "manifest.json"), MAX_MANIFEST_BYTES);
  const manifest = parseControl(manifestBuffer.toString("utf8"), "Builder request manifest");
  assertExactKeys(manifest, ["version", "jobId", "nonce", "files"], "Builder request manifest");
  if (
    manifest.version !== BUILDER_PROTOCOL_VERSION ||
    manifest.jobId !== requested.jobId ||
    manifest.nonce !== requested.nonce ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > 500
  ) {
    throw new Error("Builder request manifest identity is invalid.");
  }
  const contentSource = path.join(jobDir, "content");
  const contentInfo = await fsp.lstat(contentSource);
  if (!contentInfo.isDirectory() || contentInfo.isSymbolicLink()) throw new Error("Builder request content is unsafe.");
  const actualNames = (await fsp.readdir(contentSource)).sort();
  const expectedNames = manifest.files.map((file) => file?.name).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) throw new Error("Builder request file set does not match its manifest.");
  const contentDestination = path.join(workspace, "client-projects");
  await fsp.mkdir(contentDestination, { mode: 0o700 });
  let totalBytes = 0;
  for (const file of manifest.files) {
    assertPlainObject(file, "Builder request file");
    assertExactKeys(file, ["name", "size", "sha256"], "Builder request file");
    if (!MARKDOWN_RE.test(file.name) || !Number.isSafeInteger(file.size) || file.size < 1 || !SHA256_RE.test(file.sha256)) {
      throw new Error("Builder request file metadata is invalid.");
    }
    totalBytes += file.size;
    if (totalBytes > 32 * 1024 * 1024) throw new Error("Builder request content quota exceeded.");
    const copied = await copyRegularFile(path.join(contentSource, file.name), path.join(contentDestination, file.name), 0o600);
    if (copied.size !== file.size || copied.sha256 !== file.sha256) throw new Error("Builder request content hash mismatch.");
  }
  return contentDestination;
}

async function inventoryOutput(root, { maxBytes, maxFiles }) {
  const files = [];
  let totalBytes = 0;
  const walk = async (directory, prefix = "") => {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      safeRelativePath(relative);
      const full = path.join(directory, entry.name);
      const info = await fsp.lstat(full);
      if (info.isSymbolicLink()) throw new Error("Builder output contains a symbolic link.");
      if (info.isDirectory()) await walk(full, relative);
      else if (info.isFile()) {
        totalBytes += info.size;
        files.push({ path: relative, full, size: info.size });
        if (files.length > maxFiles || totalBytes > maxBytes) throw new Error("Builder output quota exceeded.");
      } else throw new Error("Builder output contains a special file.");
    }
  };
  await walk(root);
  if (!files.length) throw new Error("Builder produced no files.");
  files.sort((left, right) => left.path.localeCompare(right.path));
  for (const file of files) {
    const hashed = await hashRegularFile(file.full, maxBytes);
    if (hashed.size !== file.size) throw new Error("Builder output changed during inventory.");
    file.sha256 = hashed.sha256;
  }
  return { files, totalBytes };
}

async function inspectOutputQuota(root, { maxBytes, maxFiles }) {
  const stack = [root];
  let files = 0;
  let bytes = 0;
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const info = await fsp.lstat(full);
      if (info.isSymbolicLink()) throw new Error("Builder output contains a symbolic link.");
      if (info.isDirectory()) stack.push(full);
      else if (info.isFile()) {
        files += 1;
        bytes += info.size;
        if (files > maxFiles || bytes > maxBytes) throw new Error("Builder output quota exceeded.");
      } else throw new Error("Builder output contains a special file.");
    }
  }
  return { files, bytes };
}

function boundedAppend(chunks, chunk) {
  const used = chunks.reduce((total, item) => total + item.length, 0);
  if (used >= MAX_DIAGNOSTIC_BYTES) return;
  chunks.push(Buffer.from(chunk).subarray(0, MAX_DIAGNOSTIC_BYTES - used));
}

export function formatBuilderDiagnostic(error, { paths = [] } = {}) {
  const result = error?.buildResult;
  const clean = (value) => {
    let text = String(value ?? "").replace(/[\0\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "?");
    for (const item of paths) {
      if (typeof item === "string" && item) text = text.split(item).join("[path]");
    }
    text = text.replace(/(password|token|cookie|authorization|secret)\s*[:=]\s*[^\s,;]+/giu, "$1=[redacted]");
    return text.slice(0, MAX_OPERATIONAL_DIAGNOSTIC_CHARS);
  };
  const diagnostic = {
    message: clean(error?.message || "Unknown isolated builder failure."),
    code: Number.isInteger(result?.code) ? result.code : null,
    signal: typeof result?.signal === "string" ? clean(result.signal) : null,
    stderr: clean(result?.stderr),
    stdout: clean(result?.stdout),
  };
  return JSON.stringify(diagnostic).slice(0, MAX_OPERATIONAL_DIAGNOSTIC_CHARS);
}

function killProcessGroup(child, signal) {
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function createCgroupGuard() {
  const membership = await fsp.readFile("/proc/self/cgroup", "utf8");
  const unified = membership.split("\n").find((line) => line.startsWith("0::"));
  if (!unified) throw new Error("Production builder requires a dedicated cgroup v2 service.");
  const relative = unified.slice(3);
  const cgroupRoot = path.resolve("/sys/fs/cgroup", `.${relative}`);
  if (!isWithin("/sys/fs/cgroup", cgroupRoot)) throw new Error("Builder cgroup path is unsafe.");
  const processesFile = path.join(cgroupRoot, "cgroup.procs");
  const readPids = async () => (await fsp.readFile(processesFile, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(Number)
    .filter(Number.isSafeInteger);
  const initial = await readPids();
  if (initial.length !== 1 || initial[0] !== process.pid) {
    throw new Error("Production builder must be the only process in its service cgroup at startup.");
  }
  return async function clearJobProcesses() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const unexpected = (await readPids()).filter((pid) => pid !== process.pid);
      if (!unexpected.length) return;
      for (const pid of unexpected) {
        try { process.kill(pid, "SIGKILL"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Builder could not clear the completed job process tree.");
  };
}

export function isolatedBuildEnvironment({ workspace, clientProjectsDir }) {
  return {
    NODE_ENV: "production",
    ASTRO_TELEMETRY_DISABLED: "1",
    ASTRO_CACHE_DIR: path.join(workspace, ".cache", "astro"),
    LBI_VITE_CACHE_DIR: path.join(workspace, ".cache", "vite"),
    SITE_ID: "lbi",
    LBI_CLIENT_PROJECTS_DIR: clientProjectsDir,
    HOME: path.join(workspace, "home"),
    TMPDIR: path.join(workspace, "tmp"),
    TEMP: path.join(workspace, "tmp"),
    TMP: path.join(workspace, "tmp"),
    PATH: process.env.PATH ?? "",
    LANG: process.env.LANG ?? "C.UTF-8",
  };
}

export function runAstroIsolatedBuild({ sourceDir, workspace, outDir, clientProjectsDir, timeoutMs, maxOutputBytes, maxOutputFiles }) {
  return new Promise((resolve, reject) => {
    const astroCli = path.join(sourceDir, "node_modules", "astro", "bin", "astro.mjs");
    const child = spawn(process.execPath, [astroCli, "build", "--root", workspace, "--outDir", outDir], {
      cwd: workspace,
      env: isolatedBuildEnvironment({ workspace, clientProjectsDir }),
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let quotaFailure = null;
    let quotaCheckRunning = false;
    let settled = false;
    let forceKillTimer = null;
    child.stdout.on("data", (chunk) => boundedAppend(stdout, chunk));
    child.stderr.on("data", (chunk) => boundedAppend(stderr, chunk));
    const monitor = setInterval(async () => {
      if (quotaFailure || quotaCheckRunning) return;
      quotaCheckRunning = true;
      try {
        await inspectOutputQuota(outDir, { maxBytes: maxOutputBytes, maxFiles: maxOutputFiles });
      } catch (error) {
        if (error?.code === "ENOENT") return;
        quotaFailure = error;
        killProcessGroup(child, "SIGTERM");
      } finally {
        quotaCheckRunning = false;
      }
    }, 500);
    monitor.unref();
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessGroup(child, "SIGTERM");
      forceKillTimer = setTimeout(() => killProcessGroup(child, "SIGKILL"), 5_000);
      forceKillTimer.unref();
    }, timeoutMs);
    timer.unref();
    function cleanup() {
      clearInterval(monitor);
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    }
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { killProcessGroup(child, "SIGKILL"); } catch {}
      const result = {
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (quotaFailure) reject(quotaFailure);
      else if (timedOut) reject(Object.assign(new Error("Isolated Astro build timed out."), { buildResult: result }));
      else if (code === 0) resolve(result);
      else reject(Object.assign(new Error("Isolated Astro build failed."), { buildResult: result }));
    });
  });
}

async function streamOutput(socket, inventory) {
  for (const file of inventory.files) {
    await writeLine(socket, { path: file.path, size: file.size, sha256: file.sha256 });
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
    const handle = await fsp.open(file.full, flags);
    const hash = crypto.createHash("sha256");
    let size = 0;
    try {
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        size += chunk.length;
        hash.update(chunk);
        await writeAll(socket, chunk);
      }
    } finally {
      await handle.close();
    }
    if (size !== file.size || hash.digest("hex") !== file.sha256) throw new Error("Builder output changed while streaming.");
  }
}

export async function createBuilderServer(options) {
  const sourceDir = await prepareRealDirectory(options.sourceDir, "LBI_BUILDER_SOURCE_DIR");
  const requestRoot = await prepareRealDirectory(options.requestRoot, "LBI_BUILDER_REQUEST_DIR");
  const workspaceRoot = await prepareRealDirectory(options.workspaceRoot, "LBI_BUILDER_WORKSPACE_DIR", { create: true });
  for (const pair of [[sourceDir, requestRoot], [sourceDir, workspaceRoot], [requestRoot, workspaceRoot]]) {
    if (isWithin(pair[0], pair[1]) || isWithin(pair[1], pair[0])) throw new Error("Builder roots must be separate and non-nested.");
  }
  const socketPath = options.socketPath;
  if (process.platform !== "win32" && (!path.isAbsolute(socketPath) || socketPath.length > 100)) {
    throw new Error("LBI_BUILDER_SOCKET must be a short absolute Unix socket path.");
  }
  await prepareListenSocket(socketPath);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024 * 1024;
  const maxOutputFiles = options.maxOutputFiles ?? 50_000;
  const buildRunner = options.buildRunner ?? runAstroIsolatedBuild;
  const removeWorkspace = options.removeWorkspace ?? ((workspace) => fsp.rm(workspace, { recursive: true, force: true }));
  const clearJobProcesses = buildRunner === runAstroIsolatedBuild && process.platform === "linux"
    ? await createCgroupGuard()
    : async () => {};
  let busy = false;
  const server = net.createServer(async (socket) => {
    socket.setTimeout(10_000, () => socket.destroy(new Error("Builder request timed out.")));
    const reader = new SocketReader(socket);
    let request = null;
    try {
      request = parseControl(await reader.line(), "Builder request");
      assertExactKeys(request, ["version", "action", "jobId", "nonce"], "Builder request");
      if (
        request.version !== BUILDER_PROTOCOL_VERSION ||
        request.action !== "build" ||
        !UUID_RE.test(request.jobId) ||
        !NONCE_RE.test(request.nonce)
      ) throw new Error("Builder request is invalid.");
      if (busy) {
        await writeLine(socket, { version: BUILDER_PROTOCOL_VERSION, ok: false, jobId: request.jobId, nonce: request.nonce, code: "busy", message: "Builder is busy." });
        return;
      }
      busy = true;
      socket.setTimeout(timeoutMs + 30_000, () => socket.destroy(new Error("Builder job connection timed out.")));
      const workspace = path.join(workspaceRoot, request.jobId);
      const output = path.join(workspace, "site");
      try {
        await fsp.mkdir(workspace, { mode: 0o700 });
        const sourceLimits = { files: 0, directories: 0, bytes: 0, maxFiles: 100_000, maxDirectories: 25_000, maxBytes: 2 * 1024 * 1024 * 1024 };
        await copyFixedSource(sourceDir, workspace, sourceLimits, buildRunner === runAstroIsolatedBuild);
        const clientProjectsDir = await validateAndCopyRequest(requestRoot, workspace, request);
        await Promise.all([
          fsp.mkdir(output, { recursive: true, mode: 0o700 }),
          fsp.mkdir(path.join(workspace, ".cache", "astro"), { recursive: true, mode: 0o700 }),
          fsp.mkdir(path.join(workspace, ".cache", "vite"), { recursive: true, mode: 0o700 }),
          fsp.mkdir(path.join(workspace, "home"), { mode: 0o700 }),
          fsp.mkdir(path.join(workspace, "tmp"), { mode: 0o700 }),
        ]);
        await buildRunner({ sourceDir, workspace, outDir: output, clientProjectsDir, timeoutMs, maxOutputBytes, maxOutputFiles });
        await clearJobProcesses();
        const inventory = await inventoryOutput(output, { maxBytes: maxOutputBytes, maxFiles: maxOutputFiles });
        await writeLine(socket, {
          version: BUILDER_PROTOCOL_VERSION,
          ok: true,
          jobId: request.jobId,
          nonce: request.nonce,
          files: inventory.files.length,
          totalBytes: inventory.totalBytes,
        });
        await streamOutput(socket, inventory);
      } finally {
        let cleanupFailure = null;
        try { await clearJobProcesses(); } catch (error) { cleanupFailure = error; }
        try { await removeWorkspace(workspace); } catch (error) { cleanupFailure ??= error; }
        busy = false;
        if (cleanupFailure) throw cleanupFailure;
      }
      await writeLine(socket, { end: true });
    } catch (error) {
      options.onError?.(error);
      if (!socket.destroyed && request && UUID_RE.test(request.jobId ?? "") && NONCE_RE.test(request.nonce ?? "")) {
        await writeLine(socket, {
          version: BUILDER_PROTOCOL_VERSION,
          ok: false,
          jobId: request.jobId,
          nonce: request.nonce,
          code: "build_failed",
          message: "Isolated build failed.",
        }).catch(() => {});
      }
    } finally {
      socket.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  server.maxConnections = 8;
  if (process.platform !== "win32") await fsp.chmod(socketPath, 0o660);
  return {
    server,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (process.platform !== "win32") await fsp.unlink(socketPath).catch((error) => { if (error?.code !== "ENOENT") throw error; });
    },
  };
}
