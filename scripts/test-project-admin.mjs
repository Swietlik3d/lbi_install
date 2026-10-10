#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createProjectAdmin } from "../server/project-admin/app.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const RUN_ROOT = path.join(ROOT, "artifacts", "project-admin-tests", `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`);
const SOURCE = path.join(RUN_ROOT, "source");
const DATA = path.join(RUN_ROOT, "data");
const PUBLISH = path.join(RUN_ROOT, "publish");
const ORIGIN = "http://127.0.0.1:0";
const TEST_PASSWORD = ["synthetic", "project", "admin", "42"].join("-");
const ROTATED_TEST_PASSWORD = ["rotated", "synthetic", "admin", "84"].join("-");
const STATIC_RELEASE_NAME = "20260919T002319Z";

let assertions = 0;
function check(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

async function runPasswordSetup(password, { force = false } = {}) {
  const passwordFile = path.join(DATA, "auth", "password.json");
  return new Promise((resolve, reject) => {
    const args = [path.join(ROOT, "scripts", "project-admin-password.mjs")];
    if (force) args.push("--force");
    args.push(passwordFile);
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: {
        ...process.env,
        LBI_ADMIN_SOURCE_DIR: SOURCE,
        LBI_ADMIN_DATA_DIR: DATA,
        LBI_ADMIN_PUBLISH_ROOT: PUBLISH,
      },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      const output = Buffer.concat(chunks).toString("utf8");
      if (code === 0) resolve(output);
      else reject(new Error(`Password setup failed with code ${code}: ${output}`));
    });
    child.stdin.end(`${password}\n`);
  });
}

async function setupFixture() {
  await fsp.mkdir(path.join(SOURCE, "public", "beheer", "projecten"), { recursive: true });
  await fsp.mkdir(path.join(SOURCE, "dist", "lbi"), { recursive: true });
  await fsp.mkdir(path.join(DATA, "auth"), { recursive: true });
  await fsp.mkdir(path.join(PUBLISH, "releases", STATIC_RELEASE_NAME, "projecten"), { recursive: true });
  await Promise.all([
    fsp.writeFile(path.join(SOURCE, "public", "beheer", "projecten", "index.html"), "<!doctype html><title>beheer</title>"),
    fsp.writeFile(path.join(SOURCE, "public", "beheer", "projecten", "styles.css"), "body{}"),
    fsp.writeFile(path.join(SOURCE, "public", "beheer", "projecten", "app.js"), "'use strict';"),
    fsp.writeFile(path.join(SOURCE, "dist", "lbi", "index.html"), "<!doctype html><title>fallback</title>"),
    fsp.writeFile(path.join(PUBLISH, "releases", STATIC_RELEASE_NAME, "index.html"), "<!doctype html><title>seeded static release</title>"),
    fsp.writeFile(path.join(PUBLISH, "releases", STATIC_RELEASE_NAME, "projecten", "index.html"), "<!doctype html><title>seeded static projects</title>"),
    fsp.writeFile(path.join(PUBLISH, "current.txt"), `${STATIC_RELEASE_NAME}\n`),
  ]);
  const passwordFile = path.join(DATA, "auth", "password.json");
  const setupOutput = await runPasswordSetup(TEST_PASSWORD);
  check(!setupOutput.includes(TEST_PASSWORD), "password setup must not print the supplied password");
  check(!setupOutput.includes("Restart"), "initial password setup output should remain unchanged");
  const authRecord = JSON.parse(await fsp.readFile(passwordFile, "utf8"));
  equal(authRecord.algorithm, "scrypt", "password setup must store a scrypt record");
  check(!JSON.stringify(authRecord).includes(TEST_PASSWORD), "password hash file must not contain the plaintext password");
  if (process.platform !== "win32") {
    equal((await fsp.stat(passwordFile)).mode & 0o777, 0o600, "password hash file must use mode 0600");
  }
}

let failBuild = false;
let pauseBuild = null;
const buildContents = [];
async function syntheticBuild({ outDir, clientProjectsDir }) {
  if (failBuild) throw new Error("Synthetic build failure.");
  if (pauseBuild) {
    pauseBuild.entered();
    await pauseBuild.wait;
  }
  const names = (await fsp.readdir(clientProjectsDir)).filter((name) => name.endsWith(".md")).sort();
  const entries = [];
  for (const name of names) {
    entries.push({ name, text: await fsp.readFile(path.join(clientProjectsDir, name), "utf8") });
  }
  buildContents.push(entries);
  const text = entries.map((entry) => `${entry.name}\n${entry.text}`).join("\n");
  await fsp.mkdir(path.join(outDir, "projecten"), { recursive: true });
  await fsp.writeFile(path.join(outDir, "index.html"), `<!doctype html><main>${text}</main>`);
  await fsp.writeFile(path.join(outDir, "projecten", "index.html"), `<!doctype html><main>${text}</main>`);
  return { code: 0, stdout: "", stderr: "" };
}

function createClient(base, initialCookie = "") {
  let cookie = initialCookie;
  let csrf = "";
  return {
    get cookie() {
      return cookie;
    },
    get csrf() {
      return csrf;
    },
    async request(route, options = {}) {
      const headers = { ...(options.headers ?? {}) };
      if (cookie && options.cookie !== false) headers.Cookie = cookie;
      if (options.origin !== false && options.method && options.method !== "GET") headers.Origin = options.origin ?? ORIGIN;
      if (options.csrf !== false && csrf && options.method && options.method !== "GET") headers["X-CSRF-Token"] = options.csrf ?? csrf;
      let body = options.body;
      if (options.json !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(options.json);
      }
      const response = await fetch(`${base}${route}`, { method: options.method ?? "GET", headers, body, redirect: "manual" });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie && !setCookie.includes("Max-Age=0")) cookie = setCookie.split(";", 1)[0];
      const contentType = response.headers.get("content-type") ?? "";
      const value = contentType.startsWith("application/json") ? await response.json() : await response.arrayBuffer();
      if (value?.csrfToken) csrf = value.csrfToken;
      return { response, value };
    },
  };
}

async function waitForPublication(client, wanted) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await client.request("/beheer/api/publication");
    if (result.value.publication.state !== "publishing") {
      equal(result.value.publication.state, wanted, `publication should finish as ${wanted}`);
      return result.value.publication;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Publication test timed out.");
}

await setupFixture();
const commonConfig = {
  origin: ORIGIN,
  sourceDir: SOURCE,
  dataDir: DATA,
  publishRoot: PUBLISH,
  port: 0,
  usePointer: true,
};

await assert.rejects(
  createProjectAdmin({ config: { ...commonConfig, origin: "http://admin.example.invalid" }, buildRunner: syntheticBuild }),
  /must use HTTPS/u
);
assertions += 1;

await assert.rejects(
  createProjectAdmin({ config: { ...commonConfig, origin: "https://admin.example.invalid" }, buildRunner: syntheticBuild }),
  /requires the isolated project builder/u
);
assertions += 1;

await fsp.writeFile(path.join(PUBLISH, "current.txt"), "20260919T002319Z-untrusted\n");
await assert.rejects(
  createProjectAdmin({ config: commonConfig, buildRunner: syntheticBuild }),
  /Current release pointer is invalid/u
);
assertions += 1;
await fsp.writeFile(path.join(PUBLISH, "current.txt"), `${STATIC_RELEASE_NAME}\n`);

let app = await createProjectAdmin({ config: commonConfig, buildRunner: syntheticBuild });
const address = await app.listen();
const base = `http://127.0.0.1:${address.port}`;
const client = createClient(base);
let recoveryProjectId = "";

try {
  let result = await client.request("/beheer/api/projects");
  equal(result.response.status, 401, "projects must require authentication");

  result = await client.request("/beheer/api/login", {
    method: "POST",
    origin: "https://attacker.invalid",
    csrf: false,
    json: { password: TEST_PASSWORD },
  });
  equal(result.response.status, 403, "login must enforce the exact configured Origin");

  result = await client.request("/beheer/api/login", {
    method: "POST",
    csrf: false,
    json: { password: `${TEST_PASSWORD}-wrong` },
  });
  equal(result.response.status, 401, "wrong password must fail");
  check(!result.response.headers.get("set-cookie"), "failed login must not issue a session cookie");

  result = await client.request("/beheer/api/login", {
    method: "POST",
    csrf: false,
    json: { password: TEST_PASSWORD },
  });
  equal(result.response.status, 200, "valid password should authenticate");
  equal(result.value.authenticated, true, "login response should be authenticated");
  check(client.cookie.startsWith("lbi_admin_session="), "loopback session cookie should be issued");
  check(client.csrf.length >= 43, "login should return an unguessable CSRF token");

  result = await client.request("/beheer/api/projects", {
    method: "POST",
    csrf: "é".repeat(43),
    json: { title: "Unicode CSRF" },
  });
  equal(result.response.status, 403, "non-ASCII CSRF input must fail safely without a server error");

  result = await client.request("/beheer/api/projects", {
    method: "POST",
    csrf: false,
    json: { title: "Concept" },
  });
  equal(result.response.status, 403, "project save must require CSRF");

  result = await client.request("/beheer/api/projects", {
    method: "POST",
    origin: "https://attacker.invalid",
    json: { title: "Concept" },
  });
  equal(result.response.status, 403, "project save must enforce Origin even with a CSRF token");

  result = await client.request("/beheer/api/projects", {
    method: "POST",
    json: { title: "Concept", unexpected: true },
  });
  equal(result.response.status, 400, "unknown project fields must be rejected");

  result = await client.request("/beheer/api/media", {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: Buffer.from("not an image"),
  });
  equal(result.response.status, 400, "fake image content must be rejected");

  result = await client.request("/beheer/api/media/%2e%2e%2fpassword.json");
  check([400, 404].includes(result.response.status), "encoded media traversal must be rejected");

  const jpeg = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: "#ef6c00" } })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  result = await client.request("/beheer/api/media", {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: jpeg,
  });
  equal(result.response.status, 201, "valid JPEG should upload");
  const coverOne = result.value.cover;
  check(/^[0-9a-f-]{36}\.webp$/u.test(coverOne), "upload should return a UUID WebP filename");
  const processed = await sharp(path.join(DATA, "media", coverOne)).metadata();
  check((processed.width ?? 0) <= 1800 && (processed.height ?? 0) <= 1800, "processed image must fit 1800px bounds");
  equal(processed.format, "webp", "processed image must be WebP");
  check(!processed.exif, "processed image must not retain EXIF metadata");

  result = await client.request("/beheer/api/projects", {
    method: "POST",
    json: { title: "Onvolledig concept" },
  });
  equal(result.response.status, 200, "incomplete draft should save");
  equal(result.value.project.status, "concept", "new incomplete draft should be a concept");
  const incompleteId = result.value.project.id;

  result = await client.request("/beheer/api/projects");
  equal(result.response.status, 200, "authenticated project list should load");
  check(result.value.projects.some((project) => project.id === incompleteId && project.title === "Onvolledig concept"), "draft should round-trip");

  result = await client.request("/beheer/api/projects", {
    method: "POST",
    json: { id: incompleteId, cover: `${crypto.randomUUID()}.webp` },
  });
  equal(result.response.status, 400, "missing media references must be rejected");

  const foreignId = crypto.randomUUID();
  await fsp.writeFile(path.join(DATA, "media", `${foreignId}.webp`), Buffer.from("foreign"));
  result = await client.request("/beheer/api/projects", {
    method: "POST",
    json: { id: incompleteId, cover: `${foreignId}.webp` },
  });
  equal(result.response.status, 400, "unowned media without admin metadata must be rejected");

  result = await client.request("/beheer/api/projects", {
    method: "POST",
    json: {
      title: "Eerste project",
      category: "Badkamer",
      location: "Helmond",
      date: "2026-10-01",
      summary: "Een volledig synthetisch testproject.",
      coverAlt: "Oranje testvlak",
      body: "Regel met <script> en **opmaak** die tekst moet blijven.",
      cover: coverOne,
    },
  });
  equal(result.response.status, 200, "complete project draft should save");
  const projectOne = result.value.project;

  result = await client.request("/beheer/api/publish", { method: "POST", json: { id: projectOne.id } });
  equal(result.response.status, 202, "explicit publish should be accepted asynchronously");
  await waitForPublication(client, "success");
  const firstPointer = (await fsp.readFile(path.join(PUBLISH, "current.txt"), "utf8")).trim();
  check(firstPointer.length > 0, "successful publish should switch the current release pointer");

  result = await client.request("/beheer/api/projects");
  let storedOne = result.value.projects.find((project) => project.id === projectOne.id);
  equal(storedOne.status, "gepubliceerd", "published draft should report gepubliceerd");
  check(Boolean(storedOne.publishedAt), "published project should expose publishedAt");
  const firstPublishedAt = storedOne.publishedAt;

  result = await client.request("/beheer/api/projects", {
    method: "POST",
    json: { id: projectOne.id, title: "Eerste project gewijzigd" },
  });
  equal(result.value.project.status, "gewijzigd", "saving after publish must not publish implicitly");
  equal(result.value.project.publishedAt, firstPublishedAt, "saving must preserve the prior published snapshot");

  const png = await sharp({ create: { width: 640, height: 480, channels: 4, background: "#123456" } }).png().toBuffer();
  result = await client.request("/beheer/api/media", {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: png,
  });
  equal(result.response.status, 201, "valid PNG should upload");
  const coverTwo = result.value.cover;

  result = await client.request("/beheer/api/projects", {
    method: "POST",
    json: {
      title: "Tweede project",
      category: "Keuken",
      location: "Eindhoven",
      date: "2026-10-02",
      summary: "Tweede synthetische publicatie.",
      coverAlt: "Blauw testvlak",
      body: "Alleen platte tekst.",
      cover: coverTwo,
    },
  });
  const projectTwo = result.value.project;
  recoveryProjectId = projectTwo.id;
  result = await client.request("/beheer/api/publish", { method: "POST", json: { id: projectTwo.id } });
  equal(result.response.status, 202, "second explicit publish should start");
  await waitForPublication(client, "success");
  const secondBuild = buildContents.at(-1).map((entry) => entry.text).join("\n");
  check(secondBuild.includes('title: "Eerste project"'), "publishing another project must use the first project's published snapshot");
  check(!secondBuild.includes("Eerste project gewijzigd"), "another project's unpublished draft must stay isolated");
  check(secondBuild.includes('title: "Tweede project"'), "chosen draft must be included in the build");
  check(!secondBuild.includes("script&gt;") && !secondBuild.includes("**opmaak**"), "private body notes must not enter build input");
  check(!secondBuild.includes("Alleen platte tekst."), "private body notes of the selected project must stay outside the builder boundary");

  let releasePausedBuild;
  let markBuildEntered;
  const enteredBuild = new Promise((resolve) => {
    markBuildEntered = resolve;
  });
  pauseBuild = {
    entered: markBuildEntered,
    wait: new Promise((resolve) => {
      releasePausedBuild = resolve;
    }),
  };
  result = await client.request("/beheer/api/publish", { method: "POST", json: { id: projectTwo.id } });
  equal(result.response.status, 202, "race test publication should start");
  await enteredBuild;
  let saveSettled = false;
  const racingSave = client
    .request("/beheer/api/projects", {
      method: "POST",
      json: { id: projectTwo.id, summary: "Wijziging tijdens een lopende build." },
    })
    .then((value) => {
      saveSettled = true;
      return value;
    });
  await new Promise((resolve) => setTimeout(resolve, 100));
  equal(saveSettled, false, "save must wait while a publication holds the write lock");
  releasePausedBuild();
  pauseBuild = null;
  await waitForPublication(client, "success");
  result = await racingSave;
  equal(result.response.status, 200, "queued save should complete after publication");
  equal(result.value.project.status, "gewijzigd", "queued save must remain an unpublished draft change");

  const stablePointer = (await fsp.readFile(path.join(PUBLISH, "current.txt"), "utf8")).trim();
  result = await client.request("/beheer/api/projects", {
    method: "POST",
    json: { id: projectTwo.id, summary: "Niet gepubliceerde wijziging." },
  });
  equal(result.value.project.status, "gewijzigd", "failed-publication candidate should remain a changed draft");
  failBuild = true;
  result = await client.request("/beheer/api/publish", { method: "POST", json: { id: projectTwo.id } });
  equal(result.response.status, 202, "failing build should still begin asynchronously");
  await waitForPublication(client, "failed");
  const pointerAfterFailure = (await fsp.readFile(path.join(PUBLISH, "current.txt"), "utf8")).trim();
  equal(pointerAfterFailure, stablePointer, "failed build must preserve the current release");
  result = await client.request("/beheer/api/projects");
  const retainedTwo = result.value.projects.find((project) => project.id === projectTwo.id);
  equal(retainedTwo.summary, "Niet gepubliceerde wijziging.", "failed build must retain the saved draft");
  equal(retainedTwo.status, "gewijzigd", "failed build must preserve prior published state");
  failBuild = false;

  result = await client.request("/beheer/projecten/");
  equal(result.response.status, 200, "admin index should be served from its exact route");
  result = await client.request("/beheer/projecten/secret.txt");
  equal(result.response.status, 404, "unapproved admin frontend routes must not be served");

  result = await client.request("/beheer/api/logout", { method: "POST", csrf: false, json: {} });
  equal(result.response.status, 403, "logout must require CSRF");
  result = await client.request("/beheer/api/logout", { method: "POST", json: {} });
  equal(result.response.status, 200, "valid logout should succeed");
  result = await client.request("/beheer/api/projects");
  equal(result.response.status, 401, "logout must revoke the in-memory session immediately");
} finally {
  await app.close();
}

// A fresh server proves the limiter uses the socket address and ignores spoofed
// forwarding headers. It is intentionally last so it cannot block other checks.
app = await createProjectAdmin({
  config: commonConfig,
  buildRunner: syntheticBuild,
  limits: { loginGlobalAttempts: 5, loginIpAttempts: 3 },
});
const rateAddress = await app.listen();
const rateClient = createClient(`http://127.0.0.1:${rateAddress.port}`);
try {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await rateClient.request("/beheer/api/login", {
      method: "POST",
      csrf: false,
      headers: { "X-Forwarded-For": `203.0.113.${attempt + 1}` },
      json: { password: `${TEST_PASSWORD}-wrong` },
    });
    equal(result.response.status, 401, "attempt inside the per-IP limit should be evaluated");
  }
  const limited = await rateClient.request("/beheer/api/login", {
    method: "POST",
    csrf: false,
    headers: { "X-Forwarded-For": "198.51.100.200" },
    json: { password: TEST_PASSWORD },
  });
  equal(limited.response.status, 429, "forwarded-IP spoofing must not bypass the per-socket limiter");
  equal(limited.response.headers.get("retry-after"), "900", "rate limit should provide Retry-After");
} finally {
  await app.close();
}

// Simulate termination after the release pointer switches but before the record
// commits. The previous release deliberately uses the static packager's strict
// timestamp format. A fresh process must finish the journaled transaction
// idempotently without rejecting that trusted predecessor.
await fsp.writeFile(path.join(PUBLISH, "current.txt"), `${STATIC_RELEASE_NAME}\n`);
const pointerBeforeCrash = (await fsp.readFile(path.join(PUBLISH, "current.txt"), "utf8")).trim();
equal(pointerBeforeCrash, STATIC_RELEASE_NAME, "crash recovery must start from the seeded static release");
app = await createProjectAdmin({
  config: commonConfig,
  buildRunner: syntheticBuild,
  testHooks: {
    afterSwitch() {
      const error = new Error("Synthetic process termination after current switch.");
      error.simulateCrash = true;
      throw error;
    },
  },
});
const crashAddress = await app.listen();
const crashClient = createClient(`http://127.0.0.1:${crashAddress.port}`);
try {
  let result = await crashClient.request("/beheer/api/login", {
    method: "POST",
    csrf: false,
    json: { password: TEST_PASSWORD },
  });
  equal(result.response.status, 200, "crash test should authenticate");
  result = await crashClient.request("/beheer/api/publish", { method: "POST", json: { id: recoveryProjectId } });
  equal(result.response.status, 202, "journaled crash test publication should start");
  await waitForPublication(crashClient, "failed");
  const pointerAfterCrash = (await fsp.readFile(path.join(PUBLISH, "current.txt"), "utf8")).trim();
  check(pointerAfterCrash !== pointerBeforeCrash, "simulated crash must occur after current switches");
  await fsp.access(path.join(DATA, "publication-pending.json"));
  assertions += 1;
  result = await crashClient.request("/beheer/api/projects");
  equal(
    result.value.projects.find((project) => project.id === recoveryProjectId).status,
    "gewijzigd",
    "record must remain uncommitted before restart recovery"
  );
} finally {
  await app.close();
}

app = await createProjectAdmin({ config: commonConfig, buildRunner: syntheticBuild });
equal(app.publication.state, "success", "startup must complete a journal whose release is current");
await assert.rejects(fsp.access(path.join(DATA, "publication-pending.json")), /ENOENT/u);
assertions += 1;
const recoveredAddress = await app.listen();
const recoveredClient = createClient(`http://127.0.0.1:${recoveredAddress.port}`);
try {
  let result = await recoveredClient.request("/beheer/api/login", {
    method: "POST",
    csrf: false,
    json: { password: TEST_PASSWORD },
  });
  equal(result.response.status, 200, "recovered service should authenticate normally");
  result = await recoveredClient.request("/beheer/api/projects");
  const recovered = result.value.projects.find((project) => project.id === recoveryProjectId);
  equal(recovered.status, "gepubliceerd", "startup recovery must commit the matching published record");
  equal(recovered.summary, "Niet gepubliceerde wijziging.", "startup recovery must commit the journaled draft");
  result = await recoveredClient.request("/beheer/api/projects", {
    method: "POST",
    json: { id: recoveryProjectId, summary: "Kandidaat voor snapshot-cleanup." },
  });
  equal(result.value.project.status, "gewijzigd", "snapshot cleanup fault test needs an unpublished change");
} finally {
  await app.close();
}

const snapshotDirectory = path.join(DATA, "snapshots", recoveryProjectId);
const snapshotsBeforeRecordFault = (await fsp.readdir(snapshotDirectory)).sort();
await fsp.writeFile(path.join(PUBLISH, "current.txt"), `${STATIC_RELEASE_NAME}\n`);
const pointerBeforeRecordFault = (await fsp.readFile(path.join(PUBLISH, "current.txt"), "utf8")).trim();
equal(pointerBeforeRecordFault, STATIC_RELEASE_NAME, "rollback fault must start from the seeded static release");
app = await createProjectAdmin({
  config: commonConfig,
  buildRunner: syntheticBuild,
  testHooks: {
    beforeCommittedRecordWrite() {
      throw new Error("Synthetic committed-record write failure.");
    },
  },
});
const recordFaultAddress = await app.listen();
const recordFaultClient = createClient(`http://127.0.0.1:${recordFaultAddress.port}`);
try {
  let result = await recordFaultClient.request("/beheer/api/login", {
    method: "POST",
    csrf: false,
    json: { password: TEST_PASSWORD },
  });
  equal(result.response.status, 200, "record-write fault test should authenticate");
  result = await recordFaultClient.request("/beheer/api/publish", { method: "POST", json: { id: recoveryProjectId } });
  equal(result.response.status, 202, "record-write fault publication should start");
  await waitForPublication(recordFaultClient, "failed");
  const snapshotsAfterRecordFault = (await fsp.readdir(snapshotDirectory)).sort();
  assert.deepEqual(snapshotsAfterRecordFault, snapshotsBeforeRecordFault, "record failure must remove only its newly created snapshot");
  assertions += 1;
  const pointerAfterRecordFault = (await fsp.readFile(path.join(PUBLISH, "current.txt"), "utf8")).trim();
  equal(pointerAfterRecordFault, STATIC_RELEASE_NAME, "record-write failure must restore the previous static current release");
  result = await recordFaultClient.request("/beheer/api/projects");
  equal(
    result.value.projects.find((project) => project.id === recoveryProjectId).status,
    "gewijzigd",
    "record-write failure must keep the draft and prior published record"
  );
} finally {
  await app.close();
}

// Quota settings are injectable only for deterministic tests; the production
// entrypoint uses the documented hard defaults.
app = await createProjectAdmin({
  config: commonConfig,
  buildRunner: syntheticBuild,
  limits: {
    recordFiles: 1,
    minFreeUploadBytes: Number.MAX_SAFE_INTEGER,
    minFreePublishBytes: Number.MAX_SAFE_INTEGER,
  },
});
const quotaAddress = await app.listen();
const quotaClient = createClient(`http://127.0.0.1:${quotaAddress.port}`);
try {
  let result = await quotaClient.request("/beheer/api/login", {
    method: "POST",
    csrf: false,
    json: { password: TEST_PASSWORD },
  });
  equal(result.response.status, 200, "quota test should authenticate");
  result = await quotaClient.request("/beheer/api/projects", {
    method: "POST",
    json: { title: "Quota test" },
  });
  equal(result.response.status, 507, "record count quota must fail closed");
  const quotaPng = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#111111" } }).png().toBuffer();
  result = await quotaClient.request("/beheer/api/media", {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: quotaPng,
  });
  equal(result.response.status, 507, "upload free-space gate must fail closed");
  result = await quotaClient.request("/beheer/api/publish", { method: "POST", json: { id: recoveryProjectId } });
  equal(result.response.status, 507, "publish free-space gate must fail before accepting a build");
} finally {
  await app.close();
}

app = await createProjectAdmin({
  config: commonConfig,
  buildRunner: syntheticBuild,
  limits: { singleReleaseBytes: 1, minFreePublishBytes: 1 },
});
const releaseQuotaAddress = await app.listen();
const releaseQuotaClient = createClient(`http://127.0.0.1:${releaseQuotaAddress.port}`);
try {
  let result = await releaseQuotaClient.request("/beheer/api/login", {
    method: "POST",
    csrf: false,
    json: { password: TEST_PASSWORD },
  });
  equal(result.response.status, 200, "release quota test should authenticate");
  const pointerBeforeQuotaBuild = (await fsp.readFile(path.join(PUBLISH, "current.txt"), "utf8")).trim();
  result = await releaseQuotaClient.request("/beheer/api/publish", { method: "POST", json: { id: recoveryProjectId } });
  equal(result.response.status, 202, "release-size test should start within the free-space gate");
  await waitForPublication(releaseQuotaClient, "failed");
  const pointerAfterQuotaBuild = (await fsp.readFile(path.join(PUBLISH, "current.txt"), "utf8")).trim();
  equal(pointerAfterQuotaBuild, pointerBeforeQuotaBuild, "oversized staged release must never switch current");
} finally {
  await app.close();
}

// Rotation is intentionally a restart boundary: the running process caches the
// hash and sessions in memory, while a fresh process loads only the new hash and
// starts with an empty session map.
app = await createProjectAdmin({ config: commonConfig, buildRunner: syntheticBuild });
const preRotationAddress = await app.listen();
const preRotationClient = createClient(`http://127.0.0.1:${preRotationAddress.port}`);
let preRotationCookie = "";
try {
  const result = await preRotationClient.request("/beheer/api/login", {
    method: "POST",
    csrf: false,
    json: { password: TEST_PASSWORD },
  });
  equal(result.response.status, 200, "old password should work before rotation");
  preRotationCookie = preRotationClient.cookie;
  check(Boolean(preRotationCookie), "pre-rotation session cookie should exist");
} finally {
  await app.close();
}

const rotationOutput = await runPasswordSetup(ROTATED_TEST_PASSWORD, { force: true });
check(rotationOutput.includes("Restart the project-admin service"), "rotation must explicitly require a service restart");
check(!rotationOutput.includes(TEST_PASSWORD) && !rotationOutput.includes(ROTATED_TEST_PASSWORD), "rotation output must not reveal either password");

app = await createProjectAdmin({ config: commonConfig, buildRunner: syntheticBuild });
const postRotationAddress = await app.listen();
const postRotationBase = `http://127.0.0.1:${postRotationAddress.port}`;
try {
  const staleSessionClient = createClient(postRotationBase, preRotationCookie);
  let result = await staleSessionClient.request("/beheer/api/session");
  equal(result.value.authenticated, false, "old session must be rejected after rotation and restart");

  const passwordClient = createClient(postRotationBase);
  result = await passwordClient.request("/beheer/api/login", {
    method: "POST",
    csrf: false,
    json: { password: TEST_PASSWORD },
  });
  equal(result.response.status, 401, "old password must be rejected after rotation and restart");
  result = await passwordClient.request("/beheer/api/login", {
    method: "POST",
    csrf: false,
    json: { password: ROTATED_TEST_PASSWORD },
  });
  equal(result.response.status, 200, "rotated password must work after restart");
} finally {
  await app.close();
}

console.log(`PASS project-admin (${assertions} assertions)`);
console.log(`Synthetic evidence: ${path.relative(ROOT, RUN_ROOT)}`);
