import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { generateSitemap } from "../../scripts/generate-sitemap.mjs";
import { generateRobots } from "../../scripts/generate-robots.mjs";
import { createIsolatedBuildRunner } from "./isolated-builder.mjs";
import { applyPreviewProfile, loadPreviewProfile, removeEmbeddedProjectAdminFrontend } from "./preview-profile.mjs";
import { hashSessionToken, validatePasswordRecord, verifyPassword } from "./security.mjs";

const MODULE_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MEDIA_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.webp$/u;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_SESSIONS = 256;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_IP_LIMIT = 8;
const LOGIN_GLOBAL_LIMIT = 80;
const MAX_RATE_IPS = 1024;
const MAX_BUILD_DIAGNOSTIC_BYTES = 32 * 1024;
const ADMIN_RELEASE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-[0-9a-f]{8}$/u;
const STATIC_RELEASE_RE = /^\d{8}T\d{6}Z$/u;
const DEFAULT_LIMITS = Object.freeze({
  loginIpAttempts: LOGIN_IP_LIMIT,
  loginGlobalAttempts: LOGIN_GLOBAL_LIMIT,
  recordFiles: 500,
  recordBytes: 32 * 1024 * 1024,
  mediaFiles: 2000,
  mediaBytes: 2 * 1024 * 1024 * 1024,
  snapshotFiles: 1000,
  snapshotBytes: 128 * 1024 * 1024,
  releaseDirectories: 100,
  releaseBytes: 10 * 1024 * 1024 * 1024,
  releaseFiles: 500_000,
  stagingBytes: 2 * 1024 * 1024 * 1024,
  stagingFiles: 100_000,
  singleReleaseBytes: 1024 * 1024 * 1024,
  singleReleaseFiles: 50_000,
  minFreeUploadBytes: 512 * 1024 * 1024,
  minFreePublishBytes: 2 * 1024 * 1024 * 1024,
});

class HttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

class Mutex {
  #tail = Promise.resolve();

  async acquire() {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const previous = this.#tail;
    this.#tail = previous.then(() => gate, () => gate);
    await previous;
    return release;
  }

  async run(callback) {
    const release = await this.acquire();
    try {
      return await callback();
    } finally {
      release();
    }
  }
}

function normalizeLimits(overrides = {}) {
  const unknown = Object.keys(overrides).filter((key) => !(key in DEFAULT_LIMITS));
  if (unknown.length) throw new Error(`Unknown storage/rate limit: ${unknown[0]}.`);
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid limit: ${key}.`);
  }
  return Object.freeze(limits);
}

function storageError(message = "Opslaglimiet bereikt. Neem contact op met de websitebeheerder.") {
  return new HttpError(507, "storage_limit", message);
}

async function inspectTree(root, { maxBytes, maxFiles } = {}) {
  const stack = [root];
  let bytes = 0n;
  let files = 0;
  let directories = 0;
  while (stack.length) {
    const directory = stack.pop();
    directories += 1;
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      const info = await fsp.lstat(full);
      if (info.isSymbolicLink()) throw storageError("Onveilige link gevonden in beheerde opslag.");
      if (info.isDirectory()) {
        stack.push(full);
      } else if (info.isFile()) {
        files += 1;
        bytes += BigInt(info.size);
        if ((maxFiles && files > maxFiles) || (maxBytes && bytes > BigInt(maxBytes))) throw storageError();
      } else {
        throw storageError("Onondersteund bestand gevonden in beheerde opslag.");
      }
    }
  }
  return { bytes, files, directories };
}

async function ensureFreeSpace(root, minimumBytes) {
  try {
    const stats = await fsp.statfs(root, { bigint: true });
    if (stats.bavail * stats.bsize < BigInt(minimumBytes)) throw storageError("Onvoldoende vrije schijfruimte.");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw storageError("Vrije schijfruimte kon niet veilig worden gecontroleerd.");
  }
}

function normalizeCase(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function isManagedReleaseName(value) {
  return typeof value === "string" && (ADMIN_RELEASE_RE.test(value) || STATIC_RELEASE_RE.test(value));
}

async function prepareRoot(input, label, { create = false } = {}) {
  if (!input || !path.isAbsolute(input)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  const resolved = path.resolve(input);
  if (create) await fsp.mkdir(resolved, { recursive: true, mode: 0o700 });
  const info = await fsp.lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory, not a link.`);
  }
  const real = await fsp.realpath(resolved);
  if (normalizeCase(real) !== normalizeCase(resolved)) {
    throw new Error(`${label} may not traverse symbolic links or junctions.`);
  }
  return real;
}

function validateOrigin(input) {
  if (!input) throw new Error("LBI_ADMIN_ORIGIN is required.");
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("LBI_ADMIN_ORIGIN must be an exact HTTP(S) origin.");
  }
  if (parsed.origin !== input || !["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("LBI_ADMIN_ORIGIN must contain only scheme, host, and optional port.");
  }
  const host = parsed.hostname.toLowerCase();
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
  if (parsed.protocol !== "https:" && !loopback) {
    throw new Error("Non-loopback admin origins must use HTTPS.");
  }
  return parsed.origin;
}

function isLoopbackOrigin(origin) {
  const host = new URL(origin).hostname.toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
}

async function prepareBuilderSocket(input) {
  if (!input || typeof input !== "string") throw new Error("LBI_ADMIN_BUILDER_SOCKET is required.");
  if (process.platform !== "win32" && (!path.isAbsolute(input) || input.length > 100)) {
    throw new Error("LBI_ADMIN_BUILDER_SOCKET must be a short absolute Unix socket path.");
  }
  if (process.platform !== "win32") {
    const parent = await prepareRoot(path.dirname(input), "LBI_ADMIN_BUILDER_SOCKET parent");
    if (normalizeCase(parent) !== normalizeCase(path.dirname(input))) {
      throw new Error("LBI_ADMIN_BUILDER_SOCKET parent may not traverse links.");
    }
    const info = await fsp.lstat(input);
    if (!info.isSocket() || info.isSymbolicLink()) throw new Error("LBI_ADMIN_BUILDER_SOCKET must be a real Unix socket.");
    return { path: input, parent };
  }
  return { path: input, parent: null };
}

async function loadConfig(overrides = {}) {
  const sourceDir = await prepareRoot(
    overrides.sourceDir ?? process.env.LBI_ADMIN_SOURCE_DIR ?? MODULE_ROOT,
    "LBI_ADMIN_SOURCE_DIR"
  );
  const dataDir = await prepareRoot(
    overrides.dataDir ?? process.env.LBI_ADMIN_DATA_DIR,
    "LBI_ADMIN_DATA_DIR",
    { create: true }
  );
  const publishRoot = await prepareRoot(
    overrides.publishRoot ?? process.env.LBI_ADMIN_PUBLISH_ROOT,
    "LBI_ADMIN_PUBLISH_ROOT",
    { create: true }
  );
  const origin = validateOrigin(overrides.origin ?? process.env.LBI_ADMIN_ORIGIN);
  const previewProfile = await loadPreviewProfile({
    profileFile: overrides.previewProfileFile ?? process.env.LBI_ADMIN_PREVIEW_PROFILE,
    sourceDir,
    adminOrigin: origin,
  });
  const builderSocketInput = overrides.builderSocket ?? process.env.LBI_ADMIN_BUILDER_SOCKET;
  const builderRequestInput = overrides.builderRequestDir ?? process.env.LBI_ADMIN_BUILDER_REQUEST_DIR;
  if (Boolean(builderSocketInput) !== Boolean(builderRequestInput)) {
    throw new Error("Both isolated builder socket and request directory must be configured together.");
  }
  const builderRequestDir = builderRequestInput
    ? await prepareRoot(builderRequestInput, "LBI_ADMIN_BUILDER_REQUEST_DIR")
    : null;
  const preparedBuilderSocket = builderSocketInput ? await prepareBuilderSocket(builderSocketInput) : null;
  const builderSocket = preparedBuilderSocket?.path ?? null;
  if (!isLoopbackOrigin(origin) && (!builderSocket || !builderRequestDir)) {
    throw new Error("HTTPS production admin requires the isolated project builder.");
  }
  const roots = [
    sourceDir,
    dataDir,
    publishRoot,
    ...(builderRequestDir ? [builderRequestDir] : []),
    ...(preparedBuilderSocket?.parent ? [preparedBuilderSocket.parent] : []),
  ];
  for (let left = 0; left < roots.length; left += 1) {
    for (let right = left + 1; right < roots.length; right += 1) {
      if (isWithin(roots[left], roots[right]) || isWithin(roots[right], roots[left])) {
        throw new Error("Source, data, and publish roots must be separate and non-nested.");
      }
    }
  }

  const frontendDir = path.join(sourceDir, "public", "beheer", "projecten");
  const frontendInfo = await fsp.lstat(frontendDir).catch(() => null);
  if (!frontendInfo?.isDirectory() || frontendInfo.isSymbolicLink()) {
    throw new Error("Admin frontend directory is missing or unsafe.");
  }
  const frontendReal = await fsp.realpath(frontendDir);
  if (!isWithin(sourceDir, frontendReal)) throw new Error("Admin frontend must remain inside the source tree.");

  const passwordFile = path.resolve(
    overrides.passwordFile ?? process.env.LBI_ADMIN_PASSWORD_FILE ?? path.join(dataDir, "auth", "password.json")
  );
  if (!isWithin(dataDir, passwordFile)) throw new Error("Password hash file must be inside the private data directory.");

  const portValue = overrides.port ?? process.env.LBI_ADMIN_PORT ?? "4335";
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("LBI_ADMIN_PORT is invalid.");

  const config = {
    origin,
    sourceDir,
    dataDir,
    publishRoot,
    frontendDir: frontendReal,
    passwordFile,
    port,
    host: "127.0.0.1",
    recordsDir: path.join(dataDir, "records"),
    mediaDir: path.join(dataDir, "media"),
    snapshotsDir: path.join(dataDir, "snapshots"),
    diagnosticsDir: path.join(dataDir, "diagnostics"),
    releasesDir: path.join(publishRoot, "releases"),
    stagingDir: path.join(publishRoot, ".staging"),
    currentLink: path.join(publishRoot, "current"),
    currentPointer: path.join(publishRoot, "current.txt"),
    pendingPublicationFile: path.join(dataDir, "publication-pending.json"),
    builderSocket,
    builderRequestDir,
    previewProfile,
    domain: overrides.domain ?? "https://www.lbi-helmond.nl",
    usePointer: overrides.usePointer ?? process.platform === "win32",
  };
  for (const directory of [
    config.recordsDir,
    config.mediaDir,
    config.snapshotsDir,
    config.diagnosticsDir,
    config.releasesDir,
    config.stagingDir,
  ]) {
    await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await fsp.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unsafe private directory configuration.");
  }
  if (process.platform !== "win32") {
    await fsp.chmod(config.publishRoot, 0o755);
    await fsp.chmod(config.releasesDir, 0o755);
  }
  return config;
}

async function loadPasswordRecord(passwordFile, dataDir) {
  const info = await fsp.lstat(passwordFile);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Password hash path is unsafe.");
  const real = await fsp.realpath(passwordFile);
  if (!isWithin(dataDir, real) || normalizeCase(real) !== normalizeCase(passwordFile)) {
    throw new Error("Password hash file may not traverse symbolic links or junctions.");
  }
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    throw new Error("Password hash file permissions must be 0600 or stricter.");
  }
  const contents = await fsp.readFile(passwordFile, "utf8");
  if (contents.length > 16 * 1024) throw new Error("Password hash file is unexpectedly large.");
  const record = JSON.parse(contents);
  validatePasswordRecord(record);
  return record;
}

async function writeFileAtomic(target, data, mode = 0o600) {
  const directory = path.dirname(target);
  const temporary = path.join(directory, `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
  await fsp.writeFile(temporary, data, { encoding: typeof data === "string" ? "utf8" : undefined, mode, flag: "wx" });
  try {
    await fsp.rename(temporary, target);
  } catch (error) {
    if (process.platform !== "win32" || !["EEXIST", "EPERM"].includes(error?.code)) throw error;
    const backup = `${target}.${crypto.randomUUID()}.bak`;
    let backedUp = false;
    try {
      await fsp.rename(target, backup);
      backedUp = true;
      await fsp.rename(temporary, target);
      await fsp.unlink(backup).catch(() => {});
    } catch (replacementError) {
      if (backedUp) await fsp.rename(backup, target).catch(() => {});
      throw replacementError;
    }
  } finally {
    await fsp.unlink(temporary).catch(() => {});
  }
}

async function writeJsonAtomic(target, value) {
  await writeFileAtomic(target, `${JSON.stringify(value, null, 2)}\n`, 0o600);
}

async function moveDirectory(source, target) {
  let lastError;
  for (const delay of [0, 50, 100, 200, 400]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      await fsp.rename(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error?.code)) throw error;
    }
  }
  try {
    await fsp.cp(source, target, { recursive: true, force: false, errorOnExist: true });
    await fsp.rm(source, { recursive: true, force: true });
  } catch (error) {
    throw new AggregateError([lastError, error], "Could not finalize the release directory.");
  }
}

async function makePublicTree(root) {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  if (process.platform !== "win32") await fsp.chmod(root, 0o755);
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    const info = await fsp.lstat(full);
    if (info.isSymbolicLink()) throw new Error("Build output may not contain symbolic links.");
    if (info.isDirectory()) {
      await makePublicTree(full);
    } else if (info.isFile()) {
      if (process.platform !== "win32") await fsp.chmod(full, 0o644);
    } else {
      throw new Error("Build output contains an unsupported filesystem entry.");
    }
  }
}

function jsonResponse(response, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(payload.length),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...headers,
  });
  response.end(payload);
}

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(request.headers["content-length"] ?? 0);
    if (Number.isFinite(declared) && declared > limit) {
      request.resume();
      reject(new HttpError(413, "body_too_large", "Request body is too large."));
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    request.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        reject(new HttpError(413, "body_too_large", "Request body is too large."));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!settled) resolve(Buffer.concat(chunks));
    });
    request.on("aborted", () => {
      if (!settled) reject(new HttpError(400, "request_aborted", "Request was interrupted."));
    });
    request.on("error", (error) => {
      if (!settled) reject(error);
    });
  });
}

function isJsonContentType(request) {
  return /^application\/json(?:;\s*charset=utf-8)?$/iu.test(request.headers["content-type"] ?? "");
}

async function readJson(request, limit) {
  if (!isJsonContentType(request)) {
    throw new HttpError(415, "unsupported_media_type", "Content-Type must be application/json.");
  }
  const buffer = await readBody(request, limit);
  let value;
  try {
    value = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return value;
}

function enforceFields(value, allowed) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new HttpError(400, "unknown_field", `Unknown field: ${unknown[0]}.`);
}

function assertOrigin(request, config) {
  if (request.headers.origin !== config.origin) {
    throw new HttpError(403, "invalid_origin", "Request origin is not allowed.");
  }
}

function parseCookies(header = "") {
  const cookies = new Map();
  for (const item of header.split(";")) {
    const index = item.indexOf("=");
    if (index <= 0) continue;
    cookies.set(item.slice(0, index).trim(), item.slice(index + 1).trim());
  }
  return cookies;
}

function projectFields(project) {
  return {
    id: project.id,
    title: project.title,
    category: project.category,
    location: project.location,
    date: project.date,
    summary: project.summary,
    coverAlt: project.coverAlt,
    body: project.body,
    cover: project.cover,
  };
}

function sameProject(left, right) {
  if (!left || !right) return false;
  return JSON.stringify(projectFields(left)) === JSON.stringify(projectFields(right));
}

function publicProject(record) {
  const draft = record.draft;
  const published = record.published?.project;
  return {
    ...projectFields(draft),
    status: published ? (sameProject(draft, published) ? "gepubliceerd" : "gewijzigd") : "concept",
    updatedAt: draft.updatedAt,
    ...(record.published?.publishedAt ? { publishedAt: record.published.publishedAt } : {}),
  };
}

function validatePlainText(value, field, maximum, { multiline = false } = {}) {
  if (typeof value !== "string") throw new HttpError(400, "invalid_field", `${field} must be text.`);
  if (value.length > maximum) throw new HttpError(400, "invalid_field", `${field} is too long.`);
  const controls = multiline ? /[\0\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\0-\u001f\u007f]/u;
  if (controls.test(value)) throw new HttpError(400, "invalid_field", `${field} contains unsupported characters.`);
  return value.trim();
}

function validDate(value) {
  if (value === "") return true;
  if (!ISO_DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function recordPath(config, id) {
  if (!UUID_RE.test(id)) throw new HttpError(400, "invalid_id", "Project ID must be a UUID.");
  return path.join(config.recordsDir, `${id}.json`);
}

async function readRecord(config, id) {
  const file = recordPath(config, id);
  let value;
  try {
    value = JSON.parse(await fsp.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (value?.version !== 1 || value?.id !== id || value?.draft?.id !== id) {
    throw new Error("Stored project record is invalid.");
  }
  return value;
}

async function readAllRecords(config) {
  const entries = await fsp.readdir(config.recordsDir, { withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const id = entry.name.slice(0, -5);
    if (!UUID_RE.test(id)) continue;
    const record = await readRecord(config, id);
    if (record) records.push(record);
  }
  return records;
}

async function ensureRecordWriteAllowed(config, limits, target, serializedBytes) {
  const stats = await inspectTree(config.recordsDir, {
    maxBytes: limits.recordBytes,
    maxFiles: limits.recordFiles,
  });
  const existing = await fsp.lstat(target).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw storageError("Onveilige projectopslag gevonden.");
  const projectedFiles = stats.files + (existing ? 0 : 1);
  const projectedBytes = stats.bytes - BigInt(existing?.size ?? 0) + BigInt(serializedBytes);
  if (projectedFiles > limits.recordFiles || projectedBytes > BigInt(limits.recordBytes)) throw storageError();
}

async function inspectReleaseStorage(config, limits) {
  const entries = await fsp.readdir(config.releasesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !isManagedReleaseName(entry.name)) {
      throw storageError("Onverwacht bestand gevonden in de releaseopslag.");
    }
  }
  if (entries.length >= limits.releaseDirectories) throw storageError("Maximum aantal bewaarde releases bereikt.");
  const stats = await inspectTree(config.releasesDir, {
    maxBytes: limits.releaseBytes,
    maxFiles: limits.releaseFiles,
  });
  return { ...stats, releaseDirectories: entries.length };
}

async function checkPublicationStorage(config, limits) {
  await ensureFreeSpace(config.publishRoot, limits.minFreePublishBytes);
  await ensureFreeSpace(config.dataDir, limits.minFreeUploadBytes);
  const snapshots = await inspectTree(config.snapshotsDir, {
    maxBytes: limits.snapshotBytes,
    maxFiles: limits.snapshotFiles,
  });
  if (snapshots.files + 1 > limits.snapshotFiles) throw storageError("Maximum aantal publicatiemomenten bereikt.");
  await inspectTree(config.stagingDir, {
    maxBytes: limits.stagingBytes,
    maxFiles: limits.stagingFiles,
  });
  const releases = await inspectReleaseStorage(config, limits);
  return { snapshots, releases };
}

async function validateMediaReference(config, filename) {
  if (filename === "") return;
  const match = MEDIA_RE.exec(filename);
  if (!match) throw new HttpError(400, "invalid_media", "Cover must be a project media filename.");
  const [image, metadata] = await Promise.all([
    fsp.lstat(path.join(config.mediaDir, filename)).catch(() => null),
    fsp.readFile(path.join(config.mediaDir, `${match[1]}.json`), "utf8").catch(() => null),
  ]);
  if (!image?.isFile() || image.isSymbolicLink() || metadata === null) {
    throw new HttpError(400, "invalid_media", "Cover does not refer to available project media.");
  }
  let parsed;
  try {
    parsed = JSON.parse(metadata);
  } catch {
    throw new HttpError(400, "invalid_media", "Cover metadata is invalid.");
  }
  if (parsed?.version !== 1 || parsed?.id !== match[1] || parsed?.filename !== filename || parsed?.kind !== "project-admin-media") {
    throw new HttpError(400, "invalid_media", "Cover does not belong to this project administration.");
  }
}

async function normalizeProjectInput(config, body, previous) {
  enforceFields(body, new Set(["id", "title", "category", "location", "date", "summary", "coverAlt", "body", "cover"]));
  const id = body.id ?? previous?.id ?? crypto.randomUUID();
  if (!UUID_RE.test(id)) throw new HttpError(400, "invalid_id", "Project ID must be a UUID.");
  const base = previous ?? {
    title: "",
    category: "",
    location: "",
    date: "",
    summary: "",
    coverAlt: "",
    body: "",
    cover: "",
  };
  const value = {
    id,
    title: validatePlainText(body.title ?? base.title, "title", 200),
    category: validatePlainText(body.category ?? base.category, "category", 100),
    location: validatePlainText(body.location ?? base.location, "location", 160),
    date: validatePlainText(body.date ?? base.date, "date", 10),
    summary: validatePlainText(body.summary ?? base.summary, "summary", 1200, { multiline: true }),
    coverAlt: validatePlainText(body.coverAlt ?? base.coverAlt, "coverAlt", 300),
    body: validatePlainText(body.body ?? base.body, "body", 30000, { multiline: true }),
    cover: validatePlainText(body.cover ?? base.cover, "cover", 64),
    updatedAt: new Date().toISOString(),
  };
  if (!validDate(value.date)) throw new HttpError(400, "invalid_field", "date must use YYYY-MM-DD.");
  await validateMediaReference(config, value.cover);
  return value;
}

function assertPublishable(project) {
  const required = ["title", "location", "date", "summary", "coverAlt", "cover"];
  const missing = required.filter((field) => !project[field]);
  if (missing.length) {
    throw new HttpError(400, "incomplete_project", `Project is incomplete: ${missing.join(", ")}.`);
  }
}

function renderProjectMarkdown(project) {
  const cover = `/images/projects/client/${project.cover}`;
  const fields = [
    ["site", "lbi"],
    ["draft", false],
    ["title", project.title],
    ["category", project.category],
    ["location", project.location],
    ["date", project.date],
    ["summary", project.summary],
    ["cover", cover],
    ["coverAlt", project.coverAlt],
    ["exampleDetails", false],
    ["order", 0],
  ];
  return `---\n${fields.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n")}\n---\n`;
}

function boundedAppend(chunks, chunk) {
  const current = chunks.reduce((total, item) => total + item.length, 0);
  if (current >= MAX_BUILD_DIAGNOSTIC_BYTES) return;
  chunks.push(Buffer.from(chunk).subarray(0, MAX_BUILD_DIAGNOSTIC_BYTES - current));
}

export function defaultBuildRunner({ sourceDir, outDir, clientProjectsDir, env, maxOutputBytes, maxOutputFiles }) {
  return new Promise((resolve, reject) => {
    const astroCli = path.join(sourceDir, "node_modules", "astro", "bin", "astro.mjs");
    const inherited = {};
    for (const key of ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "HOME", "USERPROFILE", "LANG", "LC_ALL"]) {
      if (process.env[key] !== undefined) inherited[key] = process.env[key];
    }
    const child = spawn(process.execPath, [astroCli, "build", "--outDir", outDir], {
      cwd: sourceDir,
      env: {
        ...inherited,
        NODE_ENV: "production",
        ASTRO_TELEMETRY_DISABLED: "1",
        ...env,
        SITE_ID: "lbi",
        LBI_CLIENT_PROJECTS_DIR: clientProjectsDir,
      },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let quotaFailure = null;
    let quotaCheckRunning = false;
    child.stdout.on("data", (chunk) => boundedAppend(stdout, chunk));
    child.stderr.on("data", (chunk) => boundedAppend(stderr, chunk));
    const quotaMonitor = setInterval(async () => {
      if (quotaCheckRunning || quotaFailure) return;
      quotaCheckRunning = true;
      try {
        await inspectTree(outDir, { maxBytes: maxOutputBytes, maxFiles: maxOutputFiles });
      } catch (error) {
        if (error?.code !== "ENOENT") {
          quotaFailure = error instanceof HttpError ? error : storageError("Buildopslag kon niet veilig worden gecontroleerd.");
          child.kill("SIGTERM");
        }
      } finally {
        quotaCheckRunning = false;
      }
    }, 250);
    quotaMonitor.unref();
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, 5 * 60 * 1000);
    timeout.unref();
    child.once("error", (error) => {
      clearTimeout(timeout);
      clearInterval(quotaMonitor);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      clearInterval(quotaMonitor);
      const result = {
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (quotaFailure) {
        reject(quotaFailure);
      } else if (code === 0) {
        resolve(result);
      } else {
        const error = new Error("Astro build failed.");
        error.buildResult = result;
        reject(error);
      }
    });
  });
}

function redactDiagnostic(error, config) {
  const result = error?.buildResult;
  let text = result?.stderr || error?.message || "Unknown publication failure.";
  for (const [needle, replacement] of [
    [config.sourceDir, "[source]"],
    [config.dataDir, "[data]"],
    [config.publishRoot, "[publish]"],
  ]) {
    text = text.split(needle).join(replacement);
  }
  text = text.replace(/(password|token|cookie|authorization)\s*[:=]\s*\S+/giu, "$1=[redacted]");
  return text.slice(0, MAX_BUILD_DIAGNOSTIC_BYTES);
}

async function resolveCurrentSite(config) {
  if (config.usePointer) {
    let contents;
    try {
      contents = await fsp.readFile(config.currentPointer, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    const name = contents.trim();
    if (!isManagedReleaseName(name)) throw new Error("Current release pointer is invalid.");
    const candidate = path.join(config.releasesDir, name);
    const info = await fsp.lstat(candidate).catch(() => null);
    if (!info?.isDirectory() || info.isSymbolicLink()) throw new Error("Current release pointer target is invalid.");
    return candidate;
  }
  const info = await fsp.lstat(config.currentLink).catch(() => null);
  if (!info) return null;
  if (!info.isSymbolicLink()) throw new Error("Current release path is not a symbolic link.");
  const real = await fsp.realpath(config.currentLink);
  const targetInfo = await fsp.lstat(real);
  if (
    normalizeCase(path.dirname(real)) !== normalizeCase(config.releasesDir) ||
    !isManagedReleaseName(path.basename(real)) ||
    !targetInfo.isDirectory() ||
    targetInfo.isSymbolicLink()
  ) {
    throw new Error("Current release link target is invalid.");
  }
  return real;
}

async function currentReleaseName(config) {
  const current = await resolveCurrentSite(config);
  return current ? path.basename(current) : null;
}

async function pointCurrent(config, releaseName) {
  if (releaseName !== null && !isManagedReleaseName(releaseName)) {
    throw new Error("Release name is invalid.");
  }
  if (releaseName !== null) {
    const target = path.join(config.releasesDir, releaseName);
    const info = await fsp.lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Release target is invalid.");
  }
  if (config.usePointer) {
    if (releaseName === null) await fsp.unlink(config.currentPointer).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    else await writeFileAtomic(config.currentPointer, `${releaseName}\n`, 0o600);
    return;
  }
  const currentInfo = await fsp.lstat(config.currentLink).catch(() => null);
  if (currentInfo && !currentInfo.isSymbolicLink()) throw new Error("Current release path is unsafe.");
  if (currentInfo) {
    const currentReal = await fsp.realpath(config.currentLink);
    if (
      normalizeCase(path.dirname(currentReal)) !== normalizeCase(config.releasesDir) ||
      !isManagedReleaseName(path.basename(currentReal))
    ) {
      throw new Error("Current release link target is invalid.");
    }
  }
  if (releaseName === null) {
    await fsp.unlink(config.currentLink).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    return;
  }
  const temporary = path.join(config.publishRoot, `.current.${crypto.randomUUID()}`);
  const target = path.join("releases", releaseName);
  await fsp.symlink(target, temporary, "dir");
  try {
    await fsp.rename(temporary, config.currentLink);
  } finally {
    await fsp.unlink(temporary).catch(() => {});
  }
}

async function switchCurrent(config, releaseDir) {
  const previous = await currentReleaseName(config);
  await pointCurrent(config, path.basename(releaseDir));
  return async () => {
    await pointCurrent(config, previous);
  };
}

function validatePendingPublication(value) {
  if (
    value?.version !== 1 ||
    !UUID_RE.test(value.projectId ?? "") ||
    !ADMIN_RELEASE_RE.test(value.releaseName ?? "") ||
    !(value.previousRelease === null || isManagedReleaseName(value.previousRelease)) ||
    !/^[A-Za-z0-9.-]+\.json$/u.test(value.snapshotName ?? "") ||
    value.nextRecord?.version !== 1 ||
    value.nextRecord?.id !== value.projectId ||
    value.snapshot?.projectId !== value.projectId ||
    value.snapshotWasAbsent !== true ||
    value.nextRecord?.published?.release !== value.releaseName
  ) {
    throw new Error("Pending publication journal is invalid.");
  }
  return value;
}

async function cleanupUncommittedSnapshot(config, journal) {
  const record = await readRecord(config, journal.projectId).catch(() => null);
  if (
    record?.published?.release === journal.releaseName &&
    record?.published?.snapshot === journal.snapshotName
  ) {
    return;
  }
  const snapshotDir = path.join(config.snapshotsDir, journal.projectId);
  const snapshotPath = path.join(snapshotDir, journal.snapshotName);
  const info = await fsp.lstat(snapshotPath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return;
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Uncommitted snapshot path is unsafe.");
  const stored = JSON.parse(await fsp.readFile(snapshotPath, "utf8"));
  if (JSON.stringify(stored) !== JSON.stringify(journal.snapshot)) {
    throw new Error("Uncommitted snapshot content does not match the transaction journal.");
  }
  await fsp.unlink(snapshotPath);
  await fsp.rmdir(snapshotDir).catch(() => {});
}

async function finishPendingPublication(config, journal, hooks = {}) {
  const snapshotDir = path.join(config.snapshotsDir, journal.projectId);
  await fsp.mkdir(snapshotDir, { recursive: true, mode: 0o700 });
  const snapshotPath = path.join(snapshotDir, journal.snapshotName);
  const existingSnapshot = await fsp.lstat(snapshotPath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  let createdSnapshot = false;
  if (existingSnapshot) {
    if (!existingSnapshot.isFile() || existingSnapshot.isSymbolicLink()) {
      throw new Error("Pending snapshot path is unsafe.");
    }
    const stored = JSON.parse(await fsp.readFile(snapshotPath, "utf8"));
    if (JSON.stringify(stored) !== JSON.stringify(journal.snapshot)) {
      throw new Error("Pending snapshot conflicts with an existing snapshot.");
    }
  } else {
    await writeJsonAtomic(snapshotPath, journal.snapshot);
    createdSnapshot = true;
  }

  try {
    await hooks.beforeCommittedRecordWrite?.({ config, journal, snapshotPath });
    await writeJsonAtomic(recordPath(config, journal.projectId), journal.nextRecord);
  } catch (error) {
    const persisted = await readRecord(config, journal.projectId).catch(() => null);
    const recordCommitted =
      persisted?.published?.release === journal.releaseName &&
      persisted?.published?.snapshot === journal.snapshotName;
    if (!recordCommitted && createdSnapshot) {
      try {
        await cleanupUncommittedSnapshot(config, journal);
      } catch (cleanupError) {
        const transactionError = new AggregateError([error, cleanupError], "Record write and snapshot cleanup failed.");
        transactionError.preserveJournal = true;
        throw transactionError;
      }
    }
    if (!recordCommitted) throw error;
  }
  try {
    await fsp.unlink(config.pendingPublicationFile);
  } catch {
    // The site and record are already consistent. Keep the journal so startup
    // can retry cleanup; further publications remain blocked in this process.
    console.error("[project-admin] committed publication journal cleanup is pending");
  }
}

async function recoverPendingPublication(config) {
  const info = await fsp.lstat(config.pendingPublicationFile).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return { state: "idle" };
  if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024) {
    throw new Error("Pending publication journal is unsafe.");
  }
  const journal = validatePendingPublication(JSON.parse(await fsp.readFile(config.pendingPublicationFile, "utf8")));
  const current = await currentReleaseName(config);
  if (current === journal.releaseName) {
    await finishPendingPublication(config, journal);
    return {
      state: "success",
      projectId: journal.projectId,
      message: "Onderbroken publicatie is veilig voltooid.",
      publishedAt: journal.snapshot.publishedAt,
    };
  }
  if (current === journal.previousRelease) {
    await cleanupUncommittedSnapshot(config, journal);
    await fsp.rm(path.join(config.releasesDir, journal.releaseName), { recursive: true, force: true });
    await fsp.rm(path.join(config.stagingDir, journal.releaseName), { recursive: true, force: true });
    await fsp.unlink(config.pendingPublicationFile);
    return { state: "failed", projectId: journal.projectId, message: "Onderbroken publicatie is veilig teruggedraaid." };
  }

  const record = await readRecord(config, journal.projectId);
  if (current && record?.published?.release === current) {
    const archived = path.join(config.diagnosticsDir, `pending-conflict-${Date.now()}-${crypto.randomUUID()}.json`);
    await fsp.rename(config.pendingPublicationFile, archived);
    console.error("[project-admin] a stale publication journal was archived without changing the newer current release");
    return { state: "success", projectId: journal.projectId, message: "Nieuwere publicatie behouden." };
  }
  throw new Error("Pending publication conflicts with the current release; manual reconciliation is required.");
}

async function serveFile(response, file, { cache = false, head = false } = {}) {
  const info = await fsp.lstat(file).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) throw new HttpError(404, "not_found", "Not found.");
  const extension = path.extname(file).toLowerCase();
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".webp": "image/webp",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".xml": "application/xml; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
  }[extension] ?? "application/octet-stream";
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": String(info.size),
    "Cache-Control": cache ? "public, max-age=300" : "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    ...(extension === ".html" ? { "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" } : {}),
  });
  if (head) response.end();
  else fs.createReadStream(file).on("error", () => response.destroy()).pipe(response);
}

function safeUrlPath(rawPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    throw new HttpError(400, "invalid_path", "Invalid request path.");
  }
  if (decoded.includes("\\") || decoded.includes("\0")) throw new HttpError(400, "invalid_path", "Invalid request path.");
  const parts = decoded.split("/");
  if (parts.some((part) => part === "." || part === "..")) throw new HttpError(400, "invalid_path", "Invalid request path.");
  return decoded;
}

async function staticSiteFile(config, pathname) {
  const current = await resolveCurrentSite(config);
  const fallback = path.join(config.sourceDir, "dist", "lbi");
  const root = current ?? fallback;
  const rootInfo = await fsp.lstat(root).catch(() => null);
  if (!rootInfo?.isDirectory()) return null;
  const requested = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
  const candidate = path.resolve(root, `.${requested}`);
  if (!isWithin(root, candidate)) return null;
  const real = await fsp.realpath(candidate).catch(() => null);
  if (!real || !isWithin(root, real)) return null;
  return real;
}

export async function createProjectAdmin(options = {}) {
  const config = await loadConfig(options.config);
  await resolveCurrentSite(config);
  const passwordRecord = await loadPasswordRecord(config.passwordFile, config.dataDir);
  const limits = normalizeLimits(options.limits);
  const recoveredPublication = await recoverPendingPublication(config);
  if (!isLoopbackOrigin(config.origin) && options.buildRunner) {
    throw new Error("Production admin may not inject an in-process build runner.");
  }
  const buildRunner = config.builderSocket
    ? createIsolatedBuildRunner({ socketPath: config.builderSocket, requestRoot: config.builderRequestDir })
    : options.buildRunner ?? defaultBuildRunner;
  const sessions = new Map();
  const loginByIp = new Map();
  const globalAttempts = [];
  const writeMutex = new Mutex();
  let publication = recoveredPublication;
  let publishReserved = false;
  let closing = false;

  const secureCookie = config.origin.startsWith("https://");
  const cookieName = secureCookie ? "__Host-lbi_admin_session" : "lbi_admin_session";

  function purgeSessions() {
    const now = Date.now();
    for (const [key, session] of sessions) if (session.expiresAt <= now) sessions.delete(key);
    while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  }

  function sessionFor(request) {
    purgeSessions();
    const token = parseCookies(request.headers.cookie).get(cookieName);
    if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
    return sessions.get(hashSessionToken(token)) ?? null;
  }

  function requireSession(request) {
    const session = sessionFor(request);
    if (!session) throw new HttpError(401, "unauthorized", "Authentication required.");
    return session;
  }

  function requireMutation(request) {
    assertOrigin(request, config);
    const session = requireSession(request);
    const csrf = request.headers["x-csrf-token"];
    if (typeof csrf !== "string") {
      throw new HttpError(403, "invalid_csrf", "CSRF token is invalid.");
    }
    const left = Buffer.from(csrf);
    const right = Buffer.from(session.csrf);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
      throw new HttpError(403, "invalid_csrf", "CSRF token is invalid.");
    }
    return session;
  }

  function loginRate(ip) {
    const now = Date.now();
    const cutoff = now - LOGIN_WINDOW_MS;
    while (globalAttempts[0] && globalAttempts[0] < cutoff) globalAttempts.shift();
    let attempts = loginByIp.get(ip) ?? [];
    attempts = attempts.filter((time) => time >= cutoff);
    loginByIp.delete(ip);
    loginByIp.set(ip, attempts);
    while (loginByIp.size > MAX_RATE_IPS) loginByIp.delete(loginByIp.keys().next().value);
    const loopbackIngress = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
    const socketLimit = loopbackIngress ? limits.loginGlobalAttempts : limits.loginIpAttempts;
    if (attempts.length >= socketLimit || globalAttempts.length >= limits.loginGlobalAttempts) {
      throw new HttpError(429, "rate_limited", "Too many login attempts. Try again later.", { "Retry-After": "900" });
    }
    attempts.push(now);
    globalAttempts.push(now);
  }

  function setSessionCookie(token) {
    return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secureCookie ? "; Secure" : ""}`;
  }

  function clearSessionCookie() {
    return `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookie ? "; Secure" : ""}`;
  }

  async function saveProject(request, response) {
    requireMutation(request);
    const body = await readJson(request, 64 * 1024);
    const result = await writeMutex.run(async () => {
      const requestedId = body.id;
      const record = requestedId ? await readRecord(config, requestedId) : null;
      if (requestedId && !record) throw new HttpError(404, "project_not_found", "Project not found.");
      const draft = await normalizeProjectInput(config, body, record?.draft);
      const next = { version: 1, id: draft.id, draft, published: record?.published ?? null };
      const target = recordPath(config, draft.id);
      const serialized = `${JSON.stringify(next, null, 2)}\n`;
      await ensureRecordWriteAllowed(config, limits, target, Buffer.byteLength(serialized));
      await writeFileAtomic(target, serialized, 0o600);
      return publicProject(next);
    });
    jsonResponse(response, 200, { project: result });
  }

  async function uploadMedia(request, response) {
    requireMutation(request);
    const contentType = request.headers["content-type"] ?? "";
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
      throw new HttpError(415, "unsupported_media_type", "Upload must be JPEG, PNG, or WebP.");
    }
    await ensureFreeSpace(config.dataDir, limits.minFreeUploadBytes);
    const input = await readBody(request, 10 * 1024 * 1024);
    if (!input.length) throw new HttpError(400, "invalid_media", "Image is empty.");
    const image = sharp(input, { failOn: "error", limitInputPixels: 40_000_000, sequentialRead: true });
    let metadata;
    try {
      metadata = await image.metadata();
    } catch {
      throw new HttpError(400, "invalid_media", "Image data is invalid or unsafe.");
    }
    const expected = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" }[contentType];
    if (
      metadata.format !== expected ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > 40_000_000 ||
      (metadata.pages ?? 1) !== 1
    ) {
      throw new HttpError(400, "invalid_media", "Image format, dimensions, or frame count is not allowed.");
    }
    let output;
    try {
      output = await image.rotate().resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    } catch {
      throw new HttpError(400, "invalid_media", "Image could not be processed safely.");
    }
    const outputMetadata = await sharp(output).metadata();
    if ((outputMetadata.width ?? 0) > 1800 || (outputMetadata.height ?? 0) > 1800 || outputMetadata.format !== "webp") {
      throw new HttpError(500, "media_processing_failed", "Image processing failed.");
    }
    const id = crypto.randomUUID();
    const filename = `${id}.webp`;
    const metadataRecord = {
      version: 1,
      kind: "project-admin-media",
      id,
      filename,
      width: outputMetadata.width,
      height: outputMetadata.height,
      createdAt: new Date().toISOString(),
    };
    const serializedMetadata = `${JSON.stringify(metadataRecord, null, 2)}\n`;
    await writeMutex.run(async () => {
      await ensureFreeSpace(config.dataDir, limits.minFreeUploadBytes);
      const stats = await inspectTree(config.mediaDir, {
        maxBytes: limits.mediaBytes,
        maxFiles: limits.mediaFiles,
      });
      if (
        stats.files + 2 > limits.mediaFiles ||
        stats.bytes + BigInt(output.length + Buffer.byteLength(serializedMetadata)) > BigInt(limits.mediaBytes)
      ) {
        throw storageError();
      }
      await writeFileAtomic(path.join(config.mediaDir, filename), output, 0o600);
      await writeFileAtomic(path.join(config.mediaDir, `${id}.json`), serializedMetadata, 0o600);
    });
    jsonResponse(response, 201, { cover: filename, url: `/beheer/api/media/${filename}` });
  }

  async function performPublication(projectId, chosenDraft, storageBefore, release) {
    const releaseName = `${new Date().toISOString().replace(/[:]/gu, "-")}-${crypto.randomBytes(4).toString("hex")}`;
    const workRoot = path.join(config.stagingDir, releaseName);
    const contentDir = path.join(workRoot, "content", "projects");
    const outputDir = path.join(workRoot, "site");
    const finalRelease = path.join(config.releasesDir, releaseName);
    let rollbackCurrent = null;
    try {
      await fsp.mkdir(contentDir, { recursive: true, mode: 0o700 });
      const records = await readAllRecords(config);
      const snapshots = records
        .map((record) => (record.id === projectId ? chosenDraft : record.published?.project))
        .filter(Boolean);
      for (const project of snapshots) {
        assertPublishable(project);
        await validateMediaReference(config, project.cover);
        await writeFileAtomic(path.join(contentDir, `${project.id}.md`), renderProjectMarkdown(project), 0o600);
      }
      await buildRunner({
        sourceDir: config.sourceDir,
        outDir: outputDir,
        clientProjectsDir: contentDir,
        env: { SITE_ID: "lbi", LBI_CLIENT_PROJECTS_DIR: contentDir },
        maxOutputBytes: limits.singleReleaseBytes,
        maxOutputFiles: limits.singleReleaseFiles,
      });
      const clientImages = path.join(outputDir, "images", "projects", "client");
      await fsp.rm(clientImages, { recursive: true, force: true });
      await fsp.mkdir(clientImages, { recursive: true, mode: 0o755 });
      for (const project of snapshots) {
        await fsp.copyFile(path.join(config.mediaDir, project.cover), path.join(clientImages, project.cover));
      }
      const publicationDomain = config.previewProfile?.previewOrigins.lbi ?? config.domain;
      generateSitemap({ distDir: outputDir, domain: publicationDomain });
      generateRobots({ distDir: outputDir, domain: publicationDomain });
      if (config.previewProfile) {
        await applyPreviewProfile({ outputDir, profile: config.previewProfile });
      } else {
        await removeEmbeddedProjectAdminFrontend(outputDir);
      }
      await makePublicTree(outputDir);
      const outputStats = await inspectTree(outputDir, {
        maxBytes: limits.singleReleaseBytes,
        maxFiles: limits.singleReleaseFiles,
      });
      await inspectTree(workRoot, {
        maxBytes: limits.stagingBytes,
        maxFiles: limits.stagingFiles,
      });
      if (
        storageBefore.releases.bytes + outputStats.bytes > BigInt(limits.releaseBytes) ||
        storageBefore.releases.files + outputStats.files > limits.releaseFiles
      ) {
        throw storageError("Totale releaseopslaglimiet bereikt.");
      }
      const [home, projectsHtml] = await Promise.all([
        fsp.readFile(path.join(outputDir, "index.html"), "utf8"),
        fsp.readFile(path.join(outputDir, "projecten", "index.html"), "utf8"),
      ]);
      if (
        !home.includes(projectId) ||
        !projectsHtml.includes(projectId) ||
        !home.includes(chosenDraft.cover) ||
        !projectsHtml.includes(chosenDraft.cover)
      ) {
        throw new Error("Built output does not contain the selected project and image.");
      }
      const publishedAt = new Date().toISOString();
      const snapshotName = `${publishedAt.replace(/[:]/gu, "-")}-${crypto.randomBytes(4).toString("hex")}.json`;
      const plannedSnapshotPath = path.join(config.snapshotsDir, projectId, snapshotName);
      const snapshotCollision = await fsp.lstat(plannedSnapshotPath).catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
      });
      if (snapshotCollision) throw new Error("Generated snapshot name already exists.");
      const snapshot = {
        version: 1,
        projectId,
        publishedAt,
        release: releaseName,
        project: { ...projectFields(chosenDraft), updatedAt: chosenDraft.updatedAt },
      };
      const serializedSnapshot = `${JSON.stringify(snapshot, null, 2)}\n`;
      if (storageBefore.snapshots.bytes + BigInt(Buffer.byteLength(serializedSnapshot)) > BigInt(limits.snapshotBytes)) {
        throw storageError("Opslaglimiet voor publicatiemomenten bereikt.");
      }
      const latestRecord = await readRecord(config, projectId);
      if (!latestRecord || latestRecord.draft.updatedAt !== chosenDraft.updatedAt) {
        throw new Error("Project changed during publication.");
      }
      const nextRecord = {
        ...latestRecord,
        published: { project: snapshot.project, publishedAt, release: releaseName, snapshot: snapshotName },
      };
      const serializedRecord = `${JSON.stringify(nextRecord, null, 2)}\n`;
      await ensureRecordWriteAllowed(config, limits, recordPath(config, projectId), Buffer.byteLength(serializedRecord));
      const existingPending = await fsp.lstat(config.pendingPublicationFile).catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
      });
      if (existingPending) throw new Error("Another pending publication requires recovery.");
      const journal = {
        version: 1,
        projectId,
        releaseName,
        previousRelease: await currentReleaseName(config),
        snapshotName,
        snapshotWasAbsent: true,
        snapshot,
        nextRecord,
      };
      await writeJsonAtomic(config.pendingPublicationFile, journal);
      await moveDirectory(outputDir, finalRelease);
      await fsp.rm(workRoot, { recursive: true, force: true });
      rollbackCurrent = await switchCurrent(config, finalRelease);
      await options.testHooks?.afterSwitch?.({ config, journal });
      await finishPendingPublication(config, journal, options.testHooks);
      publication = { state: "success", projectId, message: "Project gepubliceerd.", publishedAt };
    } catch (error) {
      const simulatedCrash = error?.simulateCrash === true;
      let rollbackSucceeded = !simulatedCrash;
      if (rollbackCurrent && !simulatedCrash) {
        try {
          await rollbackCurrent();
        } catch {
          rollbackSucceeded = false;
        }
      }
      await fsp.rm(workRoot, { recursive: true, force: true }).catch(() => {});
      if (rollbackSucceeded) {
        let transactionCleanupSucceeded = true;
        try {
          await fsp.rm(finalRelease, { recursive: true, force: true });
        } catch {
          transactionCleanupSucceeded = false;
        }
        if (transactionCleanupSucceeded && error?.preserveJournal !== true) {
          await fsp.unlink(config.pendingPublicationFile).catch(() => {});
        }
      }
      publication = {
        state: "failed",
        projectId,
        message: rollbackSucceeded
          ? "Publicatie mislukt; de bestaande website is behouden."
          : "Publicatie mislukt; controle door de websitebeheerder is vereist.",
      };
      console.error(`[project-admin] publication failed: ${redactDiagnostic(error, config)}`);
    } finally {
      publishReserved = false;
      release();
    }
  }

  async function startPublication(request, response) {
    requireMutation(request);
    const body = await readJson(request, 16 * 1024);
    enforceFields(body, new Set(["id"]));
    if (!UUID_RE.test(body.id ?? "")) throw new HttpError(400, "invalid_id", "Project ID must be a UUID.");
    if (publishReserved || publication.state === "publishing") {
      throw new HttpError(409, "publication_busy", "A publication is already running.");
    }
    const pending = await fsp.lstat(config.pendingPublicationFile).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (pending) throw new HttpError(503, "publication_recovery_required", "Publicatieservice moet eerst veilig worden hersteld.");
    if (publishReserved || publication.state === "publishing") {
      throw new HttpError(409, "publication_busy", "A publication is already running.");
    }
    publishReserved = true;
    const release = await writeMutex.acquire();
    try {
      const record = await readRecord(config, body.id);
      if (!record) throw new HttpError(404, "project_not_found", "Project not found.");
      assertPublishable(record.draft);
      await validateMediaReference(config, record.draft.cover);
      const storageBefore = await checkPublicationStorage(config, limits);
      publication = { state: "publishing", projectId: body.id, message: "Publicatie wordt opgebouwd." };
      void performPublication(body.id, structuredClone(record.draft), storageBefore, release);
      jsonResponse(response, 202, { publication });
    } catch (error) {
      publishReserved = false;
      release();
      throw error;
    }
  }

  async function handleApi(request, response, pathname) {
    if (request.method === "GET" && pathname === "/beheer/api/session") {
      const session = sessionFor(request);
      jsonResponse(response, 200, session ? { authenticated: true, csrfToken: session.csrf } : { authenticated: false });
      return;
    }
    if (request.method === "POST" && pathname === "/beheer/api/login") {
      assertOrigin(request, config);
      const ip = request.socket.remoteAddress ?? "unknown";
      loginRate(ip);
      const body = await readJson(request, 16 * 1024);
      enforceFields(body, new Set(["password"]));
      const valid = await verifyPassword(body.password, passwordRecord);
      if (!valid) throw new HttpError(401, "invalid_credentials", "Password is incorrect.");
      loginByIp.delete(ip);
      purgeSessions();
      const token = crypto.randomBytes(32).toString("base64url");
      const session = { csrf: crypto.randomBytes(32).toString("base64url"), expiresAt: Date.now() + SESSION_TTL_MS };
      sessions.set(hashSessionToken(token), session);
      jsonResponse(response, 200, { authenticated: true, csrfToken: session.csrf }, { "Set-Cookie": setSessionCookie(token) });
      return;
    }
    if (request.method === "POST" && pathname === "/beheer/api/logout") {
      const session = requireMutation(request);
      const body = await readJson(request, 1024);
      enforceFields(body, new Set());
      const token = parseCookies(request.headers.cookie).get(cookieName);
      if (token) sessions.delete(hashSessionToken(token));
      session.expiresAt = 0;
      jsonResponse(response, 200, { authenticated: false }, { "Set-Cookie": clearSessionCookie() });
      return;
    }
    if (request.method === "GET" && pathname === "/beheer/api/projects") {
      requireSession(request);
      const projects = (await readAllRecords(config)).map(publicProject).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      jsonResponse(response, 200, { projects });
      return;
    }
    if (request.method === "POST" && pathname === "/beheer/api/projects") {
      await saveProject(request, response);
      return;
    }
    if (request.method === "POST" && pathname === "/beheer/api/media") {
      await uploadMedia(request, response);
      return;
    }
    const mediaMatch = /^\/beheer\/api\/media\/([^/]+)$/u.exec(pathname);
    if (request.method === "GET" && mediaMatch) {
      requireSession(request);
      if (!MEDIA_RE.test(mediaMatch[1])) throw new HttpError(404, "not_found", "Not found.");
      await validateMediaReference(config, mediaMatch[1]);
      await serveFile(response, path.join(config.mediaDir, mediaMatch[1]), { cache: false });
      return;
    }
    if (request.method === "POST" && pathname === "/beheer/api/publish") {
      await startPublication(request, response);
      return;
    }
    if (request.method === "GET" && pathname === "/beheer/api/publication") {
      requireSession(request);
      jsonResponse(response, 200, { publication });
      return;
    }
    throw new HttpError(404, "not_found", "API endpoint not found.");
  }

  const server = http.createServer(async (request, response) => {
    try {
      if (closing) throw new HttpError(503, "shutting_down", "Service is stopping.");
      if (!request.url || !request.method) throw new HttpError(400, "bad_request", "Invalid request.");
      const parsed = new URL(request.url, "http://127.0.0.1");
      const pathname = safeUrlPath(parsed.pathname);
      if (pathname.startsWith("/beheer/api/")) {
        await handleApi(request, response, pathname);
        return;
      }
      if (!["GET", "HEAD"].includes(request.method)) throw new HttpError(405, "method_not_allowed", "Method not allowed.", { Allow: "GET, HEAD" });
      const frontendRoutes = new Map([
        ["/beheer/projecten/", "index.html"],
        ["/beheer/projecten/styles.css", "styles.css"],
        ["/beheer/projecten/app.js", "app.js"],
      ]);
      if (frontendRoutes.has(pathname)) {
        await serveFile(response, path.join(config.frontendDir, frontendRoutes.get(pathname)), { head: request.method === "HEAD" });
        return;
      }
      if (pathname.startsWith("/beheer/")) throw new HttpError(404, "not_found", "Not found.");
      const file = await staticSiteFile(config, pathname);
      if (!file) throw new HttpError(404, "not_found", "Not found.");
      await serveFile(response, file, { cache: true, head: request.method === "HEAD" });
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof HttpError) {
        jsonResponse(response, error.status, { error: { code: error.code, message: error.message } }, error.headers);
      } else {
        console.error(`[project-admin] request failed: ${redactDiagnostic(error, config)}`);
        jsonResponse(response, 500, { error: { code: "internal_error", message: "Internal server error." } });
      }
    }
  });
  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  return {
    server,
    config,
    get publication() {
      return publication;
    },
    async listen() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      return server.address();
    },
    async close() {
      closing = true;
      sessions.clear();
      if (server.listening) {
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      }
      const release = await writeMutex.acquire();
      release();
    },
  };
}
