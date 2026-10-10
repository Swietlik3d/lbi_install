#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createProjectAdmin } from "../server/project-admin/app.mjs";
import { createPasswordRecord } from "../server/project-admin/security.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(THIS_FILE), "..");

async function denied(action, label) {
  try {
    await action();
  } catch (error) {
    if (["EACCES", "EPERM", "ENOENT", "EROFS", "ENETUNREACH", "EAFNOSUPPORT"].includes(error?.code)) return;
    throw new Error(`${label} failed for an unexpected reason: ${error?.code ?? error?.message}`);
  }
  throw new Error(`${label} was unexpectedly allowed.`);
}

async function tcpDenied() {
  await denied(() => new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "198.51.100.1", port: 9 });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(Object.assign(new Error("network denial was not immediate"), { code: "ETIMEDOUT" }));
    }, 1_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  }), "TCP network access");
}

async function cgroupLimits() {
  const cgroup = await fsp.readFile("/proc/self/cgroup", "utf8");
  const unified = cgroup.split("\n").find((line) => line.startsWith("0::"));
  if (!unified) throw new Error("cgroup v2 is required for the isolation proof.");
  const relative = unified.slice(3);
  const root = path.join("/sys/fs/cgroup", relative);
  const [memoryRaw, pidsRaw, cpuRaw] = await Promise.all([
    fsp.readFile(path.join(root, "memory.max"), "utf8"),
    fsp.readFile(path.join(root, "pids.max"), "utf8"),
    fsp.readFile(path.join(root, "cpu.max"), "utf8"),
  ]);
  const memory = Number(memoryRaw.trim());
  const pids = Number(pidsRaw.trim());
  const [quotaRaw, periodRaw] = cpuRaw.trim().split(/\s+/u);
  const quota = Number(quotaRaw);
  const period = Number(periodRaw);
  assert.ok(Number.isFinite(memory) && memory <= 128 * 1024 * 1024, "MemoryMax must be active");
  assert.ok(Number.isFinite(pids) && pids <= 16, "TasksMax must be active");
  assert.ok(Number.isFinite(quota) && Number.isFinite(period) && quota / period <= 2, "CPUQuota must be active");
}

async function runProbe() {
  const required = ["LBI_PROOF_PRIVATE_FILE", "LBI_PROOF_SOURCE_DIR", "LBI_PROOF_REQUEST_FILE", "LBI_PROOF_WORKSPACE_DIR", "LBI_PROOF_ADMIN_PID", "LBI_PROOF_HOST_NETNS", "LBI_PROOF_EXISTING_PRODUCTION_PATHS"];
  for (const key of required) if (!process.env[key]) throw new Error(`${key} is required.`);
  await denied(() => fsp.readFile(process.env.LBI_PROOF_PRIVATE_FILE), "private admin data read");
  const existingProductionPaths = JSON.parse(process.env.LBI_PROOF_EXISTING_PRODUCTION_PATHS);
  assert.ok(Array.isArray(existingProductionPaths), "production denial path list must be an array");
  for (const deniedPath of existingProductionPaths) {
    assert.ok(["/var/lib/lbi-project-admin", "/srv/lbi/published", "/etc/lbi"].includes(deniedPath), "production denial path must be allowlisted");
    await denied(() => fsp.lstat(deniedPath), `production path ${deniedPath} metadata read`);
  }
  await denied(() => fsp.readFile(`/proc/${process.env.LBI_PROOF_ADMIN_PID}/environ`), "admin process environment read");
  await denied(
    () => fsp.writeFile(path.join(process.env.LBI_PROOF_SOURCE_DIR, "unexpected-write"), "x", { flag: "wx" }),
    "immutable source write"
  );
  const request = await fsp.readFile(process.env.LBI_PROOF_REQUEST_FILE, "utf8");
  assert.equal(request, "public-build-input\n", "public request must remain readable");
  const workspaceTest = path.join(process.env.LBI_PROOF_WORKSPACE_DIR, `write-${process.pid}`);
  await fsp.writeFile(workspaceTest, "ok", { flag: "wx", mode: 0o600 });
  await fsp.unlink(workspaceTest);
  await tcpDenied();
  const isolatedNetns = await fsp.readlink("/proc/self/ns/net");
  assert.notEqual(isolatedNetns, process.env.LBI_PROOF_HOST_NETNS, "PrivateNetwork must create a distinct network namespace");
  await cgroupLimits();
  console.log(JSON.stringify({
    pass: true,
    checks: ["private-data-denied", "existing-production-paths-denied", "admin-env-denied", "source-readonly", "request-readable", "workspace-writable", "network-denied", "private-netns", "cgroup-limits"],
  }));
}

async function runLinger() {
  const pidFile = process.env.LBI_PROOF_CHILD_PID_FILE;
  if (!pidFile) throw new Error("LBI_PROOF_CHILD_PID_FILE is required.");
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  await fsp.writeFile(pidFile, `${child.pid}\n`, { mode: 0o600 });
  setInterval(() => {}, 1_000);
}

function execute(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { timeoutMs = 20_000, maxOutputBytes = 64 * 1024, ...spawnOptions } = options;
    const child = spawn(command, args, { ...spawnOptions, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let outputExceeded = false;
    let timedOut = false;
    const capture = (target, chunk) => {
      const remaining = Math.max(0, maxOutputBytes - outputBytes);
      if (remaining) target.push(Buffer.from(chunk).subarray(0, remaining));
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        outputExceeded = true;
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => capture(stdout, chunk));
    child.stderr.on("data", (chunk) => capture(stderr, chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut, outputExceeded, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
  });
}

async function identity(name, flag) {
  const result = await execute("id", [flag, name]);
  if (result.code !== 0) throw new Error(`Linux proof requires the '${name}' account.`);
  return result.stdout.trim();
}

function systemdProperties({ uid, gid, root, privateDir, sourceDir, requestDir, workspaceDir, runtimeDir = null, runtimeMax = null, realBuild = false }) {
  const properties = [
    `User=${uid}`,
    `Group=${gid}`,
    "NoNewPrivileges=yes",
    "PrivateNetwork=yes",
    "RestrictAddressFamilies=AF_UNIX",
    "IPAddressDeny=any",
    "ProtectSystem=strict",
    "ProtectHome=yes",
    "ProtectProc=invisible",
    "ProcSubset=pid",
    "PrivateDevices=yes",
    "PrivateTmp=yes",
    "ProtectControlGroups=yes",
    "RestrictNamespaces=yes",
    "CapabilityBoundingSet=",
    `MemoryMax=${realBuild ? "1536M" : "128M"}`,
    "MemorySwapMax=0",
    `TasksMax=${realBuild ? "128" : "16"}`,
    "CPUQuota=200%",
    "KillMode=control-group",
    `ReadOnlyPaths=${sourceDir} ${requestDir}`,
    `ReadWritePaths=${workspaceDir}${runtimeDir ? ` ${runtimeDir}` : ""}`,
    `InaccessiblePaths=${privateDir} -/var/lib/lbi-project-admin -/srv/lbi/published -/etc/lbi`,
    `WorkingDirectory=${root}`,
  ];
  if (runtimeMax) properties.push(`RuntimeMaxSec=${runtimeMax}`);
  return properties.flatMap((property) => ["--property", property]);
}

async function pidExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForSocket(socketPath, unitName) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const info = await fsp.lstat(socketPath).catch(() => null);
    if (info?.isSocket()) return;
    const state = await execute("systemctl", ["is-active", unitName], { timeoutMs: 1_000 });
    if (state.timedOut) throw new Error("systemctl timed out while waiting for the real builder socket.");
    if (state.stdout.trim() === "failed" || state.stdout.trim() === "inactive") {
      throw new Error(`Real builder unit stopped before creating its socket (${state.stdout.trim()}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Real builder did not create its socket within 10 seconds.");
}

async function realIsolatedAstroBuild({ uid, gid, root, privateDir, sourceDir }) {
  const astroCli = path.join(sourceDir, "node_modules", "astro", "bin", "astro.mjs");
  const cliInfo = await fsp.lstat(astroCli).catch(() => null);
  if (!cliInfo?.isFile() || cliInfo.isSymbolicLink()) throw new Error("BLOCKED: fixed Astro 7 CLI is missing or unsafe.");
  const requestDir = path.join(root, "real-requests");
  const workspaceDir = path.join(root, "real-workspace");
  const runtimeDir = path.join(root, "real-runtime");
  const dataDir = path.join(privateDir, "admin-data");
  const publishDir = path.join(privateDir, "published");
  await Promise.all([
    fsp.mkdir(requestDir, { mode: 0o2750 }),
    fsp.mkdir(workspaceDir, { mode: 0o700 }),
    fsp.mkdir(runtimeDir, { mode: 0o750 }),
    fsp.mkdir(path.join(dataDir, "auth"), { recursive: true, mode: 0o700 }),
    fsp.mkdir(publishDir, { mode: 0o755 }),
  ]);
  await Promise.all([
    fsp.chown(requestDir, 0, Number(gid)),
    fsp.chown(workspaceDir, Number(uid), Number(gid)),
    fsp.chown(runtimeDir, Number(uid), Number(gid)),
  ]);
  await fsp.chmod(requestDir, 0o2750);
  const password = ["synthetic", "linux", "builder", "proof", "42"].join("-");
  const passwordRecord = await createPasswordRecord(password);
  await fsp.writeFile(path.join(dataDir, "auth", "password.json"), `${JSON.stringify(passwordRecord)}\n`, { mode: 0o600 });
  const socketPath = path.join(runtimeDir, "builder.sock");
  const unitName = `lbi-builder-real-${process.pid}`;
  const properties = systemdProperties({
    uid,
    gid,
    root,
    privateDir,
    sourceDir,
    requestDir,
    workspaceDir,
    runtimeDir,
    runtimeMax: "7min",
    realBuild: true,
  });
  let app;
  try {
    const started = await execute("systemd-run", [
      "--quiet", "--collect", `--unit=${unitName}`,
      ...properties,
      `--setenv=LBI_BUILDER_SOURCE_DIR=${sourceDir}`,
      `--setenv=LBI_BUILDER_REQUEST_DIR=${requestDir}`,
      `--setenv=LBI_BUILDER_WORKSPACE_DIR=${workspaceDir}`,
      `--setenv=LBI_BUILDER_SOCKET=${socketPath}`,
      process.execPath, path.join(sourceDir, "server", "project-admin", "builder.mjs"),
    ]);
    if (started.timedOut || started.outputExceeded || started.code !== 0) {
      throw new Error(`Failed to start real isolated builder: ${started.stderr.trim()}`);
    }
    await waitForSocket(socketPath, unitName);
    const origin = "http://127.0.0.1:0";
    app = await createProjectAdmin({
      config: {
        origin,
        sourceDir,
        dataDir,
        publishRoot: publishDir,
        builderSocket: socketPath,
        builderRequestDir: requestDir,
        port: 0,
        usePointer: true,
      },
    });
    const address = await app.listen();
    const base = `http://127.0.0.1:${address.port}`;
    let cookie = "";
    let csrf = "";
    const request = async (route, { method = "GET", json, body, contentType } = {}) => {
      const headers = {};
      if (cookie) headers.Cookie = cookie;
      if (method !== "GET") headers.Origin = origin;
      if (csrf && method !== "GET") headers["X-CSRF-Token"] = csrf;
      if (json !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(json);
      } else if (contentType) headers["Content-Type"] = contentType;
      const response = await fetch(`${base}${route}`, { method, headers, body, signal: AbortSignal.timeout(30_000) });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";", 1)[0];
      const value = await response.json();
      if (value.csrfToken) csrf = value.csrfToken;
      if (!response.ok) throw new Error(`Admin E2E ${method} ${route} failed (${response.status}): ${value.error?.message ?? "unknown"}`);
      return value;
    };
    await request("/beheer/api/login", { method: "POST", json: { password } });
    const image = await sharp({ create: { width: 32, height: 24, channels: 3, background: "#123456" } }).png().toBuffer();
    const uploaded = await request("/beheer/api/media", { method: "POST", body: image, contentType: "image/png" });
    const privateNote = `PRIVATE-NOTE-MUST-NOT-CROSS-${crypto.randomUUID()}`;
    const created = await request("/beheer/api/projects", {
      method: "POST",
      json: {
        title: "Isolated builder proof",
        category: "Test",
        location: "Helmond",
        date: "2026-10-10",
        summary: "Synthetic public build input.",
        coverAlt: "Synthetic proof image",
        body: privateNote,
        cover: uploaded.cover,
      },
    });
    const projectId = created.project.id;
    await request("/beheer/api/publish", { method: "POST", json: { id: projectId } });
    let publication;
    const deadline = Date.now() + 6 * 60 * 1000;
    while (Date.now() < deadline) {
      publication = (await request("/beheer/api/publication")).publication;
      if (publication.state !== "publishing") break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.equal(publication?.state, "success", `real isolated publication must succeed: ${publication?.message ?? "timeout"}`);
    const release = (await fsp.readFile(path.join(publishDir, "current.txt"), "utf8")).trim();
    const outputDir = path.join(publishDir, "releases", release);
    const [home, projects] = await Promise.all([
      fsp.readFile(path.join(outputDir, "index.html"), "utf8"),
      fsp.readFile(path.join(outputDir, "projecten", "index.html"), "utf8"),
    ]);
    assert.ok(home.includes(projectId), "real isolated home build must contain the synthetic project ID");
    assert.ok(projects.includes(projectId), "real isolated projects build must contain the synthetic project ID");
    assert.ok(!home.includes(privateNote) && !projects.includes(privateNote), "private body note must not cross into the real build output");
    assert.ok(await fsp.lstat(path.join(outputDir, "images", "projects", "client", uploaded.cover)), "admin must add approved media after the isolated build");
    assert.equal((await fsp.readdir(requestDir)).length, 0, "real admin client must clean its exact request");
    assert.equal((await fsp.readdir(workspaceDir)).length, 0, "real builder must clean its job workspace");
  } finally {
    await app?.close().catch(() => {});
    await execute("systemctl", ["stop", unitName]);
    await execute("systemctl", ["reset-failed", unitName]);
  }
}

async function orchestrate() {
  if (process.platform !== "linux") throw new Error("BLOCKED: Linux OS isolation proof requires Linux.");
  if (process.getuid?.() !== 0) throw new Error("BLOCKED: run this disposable proof as root so systemd can select a test UID.");
  const systemdState = await execute("systemctl", ["is-system-running"]);
  if (![0, 1].includes(systemdState.code)) throw new Error("BLOCKED: a running systemd manager is required.");
  const uid = await identity("nobody", "-u");
  const gid = await identity("nobody", "-g");
  const root = await fsp.mkdtemp("/var/lib/lbi-builder-proof-");
  const privateDir = path.join(root, "private-admin");
  const sourceDir = path.join(root, "source");
  const requestDir = path.join(root, "requests");
  const workspaceDir = path.join(root, "workspace");
  const requestFile = path.join(requestDir, "public.md");
  const privateFile = path.join(privateDir, "password-record.json");
  const childPidFile = path.join(workspaceDir, "child.pid");
  const probeUnit = `lbi-builder-proof-${process.pid}`;
  const lingerUnit = `lbi-builder-tree-${process.pid}`;
  let sentinel;
  try {
    await fsp.chmod(root, 0o755);
    await Promise.all([
      fsp.mkdir(privateDir, { mode: 0o700 }),
      fsp.mkdir(sourceDir, { mode: 0o755 }),
      fsp.mkdir(requestDir, { mode: 0o755 }),
      fsp.mkdir(workspaceDir, { mode: 0o700 }),
    ]);
    await fsp.chown(workspaceDir, Number(uid), Number(gid));
    await Promise.all([
      fsp.writeFile(privateFile, "synthetic-secret-never-print\n", { mode: 0o600 }),
      fsp.writeFile(path.join(sourceDir, "immutable.txt"), "fixed-source\n", { mode: 0o444 }),
      fsp.writeFile(requestFile, "public-build-input\n", { mode: 0o444 }),
    ]);
    sentinel = spawn("sleep", ["60"], {
      env: { LBI_PROOF_SENTINEL_SECRET: crypto.randomBytes(32).toString("hex") },
      stdio: "ignore",
    });
    const hostNetns = await fsp.readlink("/proc/self/ns/net");
    const existingProductionPaths = [];
    for (const candidate of ["/var/lib/lbi-project-admin", "/srv/lbi/published", "/etc/lbi"]) {
      if (await fsp.lstat(candidate).catch(() => null)) existingProductionPaths.push(candidate);
    }
    const properties = systemdProperties({ uid, gid, root, privateDir, sourceDir, requestDir, workspaceDir, runtimeMax: "20s" });
    const probe = await execute("systemd-run", [
      "--quiet", "--wait", "--pipe", "--collect", `--unit=${probeUnit}`,
      ...properties,
      `--setenv=LBI_PROOF_PRIVATE_FILE=${privateFile}`,
      `--setenv=LBI_PROOF_SOURCE_DIR=${sourceDir}`,
      `--setenv=LBI_PROOF_REQUEST_FILE=${requestFile}`,
      `--setenv=LBI_PROOF_WORKSPACE_DIR=${workspaceDir}`,
      `--setenv=LBI_PROOF_ADMIN_PID=${sentinel.pid}`,
      `--setenv=LBI_PROOF_HOST_NETNS=${hostNetns}`,
      `--setenv=LBI_PROOF_EXISTING_PRODUCTION_PATHS=${JSON.stringify(existingProductionPaths)}`,
      process.execPath, THIS_FILE, "--probe",
    ]);
    if (probe.timedOut || probe.outputExceeded) throw new Error("FAIL Linux sandbox probe exceeded its client time/output bound.");
    if (probe.code !== 0) throw new Error(`FAIL Linux sandbox probe: ${probe.stderr.trim() || probe.stdout.trim()}`);
    const reportLine = probe.stdout.trim().split("\n").findLast((line) => line.startsWith("{"));
    const report = JSON.parse(reportLine ?? "null");
    assert.equal(report?.pass, true, "sandbox probe must report PASS");

    const linger = await execute("systemd-run", [
      "--quiet", "--wait", "--pipe", "--collect", `--unit=${lingerUnit}`,
      ...systemdProperties({ uid, gid, root, privateDir, sourceDir, requestDir, workspaceDir, runtimeMax: "2s" }),
      `--setenv=LBI_PROOF_CHILD_PID_FILE=${childPidFile}`,
      process.execPath, THIS_FILE, "--linger",
    ], { timeoutMs: 15_000 });
    assert.notEqual(linger.code, 0, "RuntimeMaxSec must terminate the lingering job");
    const childPid = Number((await fsp.readFile(childPidFile, "utf8")).trim());
    for (let attempt = 0; attempt < 20 && await pidExists(childPid); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(await pidExists(childPid), false, "KillMode=control-group must remove the spawned process tree");
    const realSource = path.resolve(process.env.LBI_PROOF_REAL_SOURCE_DIR ?? REPOSITORY_ROOT);
    await realIsolatedAstroBuild({ uid, gid, root, privateDir, sourceDir: realSource });
    console.log("PASS project-admin-builder Linux OS isolation + real admin publication through Astro");
    console.log("Evidence class: real kernel/systemd denial, cgroup enforcement, process-tree kill, and isolated Astro daemon IPC build.");
  } finally {
    sentinel?.kill("SIGKILL");
    await execute("systemctl", ["stop", probeUnit]).catch(() => {});
    await execute("systemctl", ["stop", lingerUnit]).catch(() => {});
    await execute("systemctl", ["reset-failed", probeUnit]).catch(() => {});
    await execute("systemctl", ["reset-failed", lingerUnit]).catch(() => {});
    if (root.startsWith("/var/lib/lbi-builder-proof-")) await fsp.rm(root, { recursive: true, force: true });
  }
}

if (process.argv[2] === "--probe") await runProbe();
else if (process.argv[2] === "--linger") await runLinger();
else await orchestrate();
