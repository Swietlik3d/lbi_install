#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBuilderServer, createIsolatedBuildRunner, formatBuilderDiagnostic, isolatedBuildEnvironment } from "../server/project-admin/isolated-builder.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const RUN_ROOT = path.join(ROOT, "artifacts", "project-admin-tests", `builder-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`);
const SOURCE = path.join(RUN_ROOT, "source");
const REQUESTS = path.join(RUN_ROOT, "requests");
const WORKSPACES = path.join(RUN_ROOT, "workspaces");
const INPUT = path.join(RUN_ROOT, "input");
const SOCKET = process.platform === "win32"
  ? `\\\\.\\pipe\\lbi-project-builder-${process.pid}-${crypto.randomBytes(4).toString("hex")}`
  : path.join(RUN_ROOT, "builder.sock");
const PROJECT_ID = crypto.randomUUID();
let assertions = 0;

function check(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

async function fixture() {
  await fsp.mkdir(RUN_ROOT, { recursive: true });
  await Promise.all([
    fsp.mkdir(path.join(SOURCE, "src"), { recursive: true }),
    fsp.mkdir(path.join(SOURCE, "public"), { recursive: true }),
    fsp.mkdir(path.join(SOURCE, "node_modules"), { recursive: true }),
    fsp.mkdir(REQUESTS, { recursive: true }),
    fsp.mkdir(WORKSPACES, { recursive: true }),
    fsp.mkdir(INPUT, { recursive: true }),
  ]);
  await Promise.all([
    fsp.writeFile(path.join(SOURCE, "package.json"), "{}\n"),
    fsp.writeFile(path.join(SOURCE, "astro.config.ts"), "export default {};\n"),
    fsp.writeFile(path.join(SOURCE, "src", "entry.txt"), "fixed public source\n"),
    fsp.writeFile(path.join(SOURCE, "public", "asset.txt"), "public asset\n"),
    fsp.writeFile(path.join(INPUT, `${PROJECT_ID}.md`), "---\ntitle: Public title\n---\n"),
  ]);
}

async function start(buildRunner, serverOptions = {}) {
  return createBuilderServer({
    sourceDir: SOURCE,
    requestRoot: REQUESTS,
    workspaceRoot: WORKSPACES,
    socketPath: SOCKET,
    buildRunner,
    timeoutMs: 2_000,
    maxOutputBytes: 1024 * 1024,
    maxOutputFiles: 100,
    onError(error) {
      if (process.env.LBI_BUILDER_TEST_DEBUG === "1") console.error(error);
    },
    ...serverOptions,
  });
}

async function syntheticBuild({ workspace, outDir, clientProjectsDir }) {
  check((await fsp.lstat(path.join(workspace, ".cache", "astro"))).isDirectory(), "builder creates a per-job Astro cache directory");
  check((await fsp.lstat(path.join(workspace, ".cache", "vite"))).isDirectory(), "builder creates a per-job Vite cache directory");
  const names = await fsp.readdir(clientProjectsDir);
  equal(names.length, 1, "builder receives only the selected public Markdown files");
  const markdown = await fsp.readFile(path.join(clientProjectsDir, names[0]), "utf8");
  check(markdown.includes("Public title"), "builder receives public website content");
  await fsp.mkdir(path.join(outDir, "projecten"), { recursive: true });
  await Promise.all([
    fsp.writeFile(path.join(outDir, "index.html"), `<main id="client-${PROJECT_ID}">Public title</main>`),
    fsp.writeFile(path.join(outDir, "projecten", "index.html"), `<main id="client-${PROJECT_ID}">Public title</main>`),
  ]);
}

await fixture();
const environmentFixture = isolatedBuildEnvironment({ workspace: WORKSPACES, clientProjectsDir: INPUT });
equal(environmentFixture.ASTRO_CACHE_DIR, path.join(WORKSPACES, ".cache", "astro"), "Astro cache stays inside the writable job workspace");
equal(environmentFixture.LBI_VITE_CACHE_DIR, path.join(WORKSPACES, ".cache", "vite"), "Vite cache stays inside the writable job workspace");
check(!environmentFixture.LBI_VITE_CACHE_DIR.includes("node_modules"), "isolated Vite cache never targets shared dependencies");
const diagnostic = formatBuilderDiagnostic(Object.assign(new Error(`Failure in ${SOURCE} password=synthetic-value`), {
  buildResult: {
    code: 7,
    signal: "SIGTERM",
    stderr: `${WORKSPACES} native module failed token=do-not-log\n${"x".repeat(32 * 1024)}`,
    stdout: "bounded public build output",
  },
}), { paths: [SOURCE, WORKSPACES] });
check(diagnostic.includes('"code":7') && diagnostic.includes("native module failed"), "operational diagnostic retains bounded build failure evidence");
check(!diagnostic.includes(SOURCE) && !diagnostic.includes(WORKSPACES), "operational diagnostic redacts configured paths");
check(!diagnostic.includes("synthetic-value") && !diagnostic.includes("do-not-log"), "operational diagnostic redacts secret-like values");
check(diagnostic.length <= 16 * 1024, "operational diagnostic is bounded for journald");

let server = await start(syntheticBuild);
try {
  const output = path.join(RUN_ROOT, "success-output");
  const runner = createIsolatedBuildRunner({ socketPath: SOCKET, requestRoot: REQUESTS, timeoutMs: 3_000 });
  await runner({ outDir: output, clientProjectsDir: INPUT, maxOutputBytes: 1024 * 1024, maxOutputFiles: 100 });
  check((await fsp.readFile(path.join(output, "index.html"), "utf8")).includes(PROJECT_ID), "validated builder output reaches admin staging");
  equal((await fsp.readdir(REQUESTS)).length, 0, "admin removes only its completed request directory");
  equal((await fsp.readdir(WORKSPACES)).length, 0, "builder removes its completed workspace");
} finally {
  await server.close();
}

// A compromised build may create links, but the trusted boundary daemon must
// refuse to stream them into the admin-owned staging tree.
if (process.platform !== "win32") {
  server = await start(async ({ outDir }) => {
    await fsp.mkdir(outDir, { recursive: true });
    await fsp.symlink("/etc/passwd", path.join(outDir, "index.html"));
  });
  try {
    const runner = createIsolatedBuildRunner({ socketPath: SOCKET, requestRoot: REQUESTS, timeoutMs: 3_000 });
    await assert.rejects(
      runner({ outDir: path.join(RUN_ROOT, "link-output"), clientProjectsDir: INPUT, maxOutputBytes: 1024 * 1024, maxOutputFiles: 100 }),
      /Isolated builder failed/u
    );
    assertions += 1;
  } finally {
    await server.close();
  }
}

server = await start(async ({ outDir }) => {
  await fsp.mkdir(outDir, { recursive: true });
  await fsp.writeFile(path.join(outDir, "index.html"), Buffer.alloc(8_192));
});
try {
  const runner = createIsolatedBuildRunner({ socketPath: SOCKET, requestRoot: REQUESTS, timeoutMs: 3_000 });
  await assert.rejects(
    runner({ outDir: path.join(RUN_ROOT, "quota-output"), clientProjectsDir: INPUT, maxOutputBytes: 128, maxOutputFiles: 100 }),
    /quota|failed/u
  );
  assertions += 1;
} finally {
  await server.close();
}

server = await start(syntheticBuild, {
  async removeWorkspace() {
    throw new Error("Synthetic final workspace cleanup failure.");
  },
});
try {
  const runner = createIsolatedBuildRunner({ socketPath: SOCKET, requestRoot: REQUESTS, timeoutMs: 3_000 });
  await assert.rejects(
    runner({ outDir: path.join(RUN_ROOT, "cleanup-fault-output"), clientProjectsDir: INPUT, maxOutputBytes: 1024 * 1024, maxOutputFiles: 100 }),
    /incomplete|failed/u
  );
  assertions += 1;
} finally {
  await server.close();
  await fsp.rm(WORKSPACES, { recursive: true, force: true });
  await fsp.mkdir(WORKSPACES, { recursive: true });
}

// An intentionally hostile protocol peer cannot escape the admin staging root.
const hostileSocket = process.platform === "win32"
  ? `\\\\.\\pipe\\lbi-project-hostile-${process.pid}-${crypto.randomBytes(4).toString("hex")}`
  : path.join(RUN_ROOT, "hostile.sock");
const hostile = net.createServer((socket) => {
  let buffered = "";
  socket.on("data", (chunk) => {
    buffered += chunk.toString("utf8");
    const newline = buffered.indexOf("\n");
    if (newline === -1) return;
    const request = JSON.parse(buffered.slice(0, newline));
    socket.write(`${JSON.stringify({ version: 1, ok: true, jobId: request.jobId, nonce: request.nonce, files: 1, totalBytes: 1 })}\n`);
    socket.write(`${JSON.stringify({ path: "../escape.html", size: 1, sha256: crypto.createHash("sha256").update("x").digest("hex") })}\n`);
    socket.end("x");
  });
});
await new Promise((resolve, reject) => {
  hostile.once("error", reject);
  hostile.listen(hostileSocket, resolve);
});
try {
  const runner = createIsolatedBuildRunner({ socketPath: hostileSocket, requestRoot: REQUESTS, timeoutMs: 3_000 });
  await assert.rejects(
    runner({ outDir: path.join(RUN_ROOT, "hostile-output"), clientProjectsDir: INPUT, maxOutputBytes: 1024, maxOutputFiles: 10 }),
    /invalid path/u
  );
  assertions += 1;
  check(!(await fsp.lstat(path.join(RUN_ROOT, "escape.html")).catch(() => null)), "hostile output path cannot escape admin staging");
} finally {
  await new Promise((resolve, reject) => hostile.close((error) => error ? reject(error) : resolve()));
  if (process.platform !== "win32") await fsp.unlink(hostileSocket).catch(() => {});
}

console.log(`PASS project-admin-builder protocol (${assertions} assertions)`);
console.log("Evidence class: code/protocol integration with a synthetic builder; this is not Linux OS sandbox proof.");
console.log(`Synthetic evidence: ${path.relative(ROOT, RUN_ROOT)}`);
