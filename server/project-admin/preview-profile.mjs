import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

const SITE_IDS = Object.freeze(["lbi", "elektra", "lekkage", "gas"]);
const TEXT_EXTENSIONS = new Set([".html", ".css", ".js", ".mjs", ".json", ".xml", ".txt", ".svg"]);
const MAX_PROFILE_BYTES = 32 * 1024;
const MAX_TEXT_FILE_BYTES = 32 * 1024 * 1024;
const NOINDEX_TAG = '<meta name="robots" content="noindex,nofollow,noarchive">';

function normalizeCase(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${label} fields are invalid.`);
}

function exactHttpsOrigin(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an HTTPS origin.`);
  }
  if (parsed.protocol !== "https:" || parsed.origin !== value) throw new Error(`${label} must be an exact HTTPS origin.`);
  return parsed.origin;
}

async function realFileInside(file, root, label) {
  const resolved = path.resolve(file);
  if (!isWithin(root, resolved)) throw new Error(`${label} must stay inside the immutable source tree.`);
  const info = await fsp.lstat(resolved);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a real regular file.`);
  const real = await fsp.realpath(resolved);
  if (!isWithin(root, real) || normalizeCase(real) !== normalizeCase(resolved)) throw new Error(`${label} may not traverse links.`);
  return { path: real, info };
}

async function readJsonFile(file, limit, label) {
  const info = await fsp.lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error(`${label} is unsafe or too large.`);
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

export async function loadPreviewProfile({ profileFile, sourceDir, adminOrigin }) {
  if (!profileFile) return null;
  if (!path.isAbsolute(profileFile)) throw new Error("LBI_ADMIN_PREVIEW_PROFILE must be an absolute path.");
  const sourceRoot = await fsp.realpath(path.resolve(sourceDir));
  const deployRoot = path.join(sourceRoot, "deploy");
  const deployInfo = await fsp.lstat(deployRoot);
  if (!deployInfo.isDirectory() || deployInfo.isSymbolicLink()) throw new Error("Immutable deploy directory is unsafe.");
  const deployReal = await fsp.realpath(deployRoot);
  if (normalizeCase(deployReal) !== normalizeCase(deployRoot)) throw new Error("Immutable deploy directory may not traverse links.");
  const profile = await realFileInside(profileFile, deployReal, "LBI_ADMIN_PREVIEW_PROFILE");
  const registry = await realFileInside(path.join(sourceRoot, "src", "config", "sites.json"), sourceRoot, "Site registry");
  const [rawProfile, rawSites] = await Promise.all([
    readJsonFile(profile.path, MAX_PROFILE_BYTES, "Preview profile"),
    readJsonFile(registry.path, MAX_PROFILE_BYTES, "Site registry"),
  ]);
  exactKeys(rawProfile, ["host", "remoteRoot", "sites"], "Preview profile");
  exactKeys(rawProfile.sites, SITE_IDS, "Preview profile sites");
  exactKeys(rawSites, SITE_IDS, "Site registry");
  if (typeof rawProfile.host !== "string" || !rawProfile.host || typeof rawProfile.remoteRoot !== "string" || !rawProfile.remoteRoot.startsWith("/")) {
    throw new Error("Preview profile deployment metadata is invalid.");
  }
  const previewOrigins = {};
  const productionOrigins = {};
  for (const id of SITE_IDS) {
    previewOrigins[id] = exactHttpsOrigin(rawProfile.sites[id], `Preview origin ${id}`);
    productionOrigins[id] = exactHttpsOrigin(rawSites[id]?.domain, `Production origin ${id}`);
  }
  if (new Set(Object.values(previewOrigins)).size !== SITE_IDS.length) throw new Error("Preview origins must be distinct.");
  if (previewOrigins.lbi !== adminOrigin) throw new Error("Preview LBI origin must exactly match LBI_ADMIN_ORIGIN.");
  return Object.freeze({
    profileFile: profile.path,
    previewOrigins: Object.freeze(previewOrigins),
    productionOrigins: Object.freeze(productionOrigins),
  });
}

function rewriteOrigins(value, profile) {
  let rewritten = value;
  for (const id of SITE_IDS) {
    const hostname = new URL(profile.productionOrigins[id]).hostname.replace(/^www\./u, "");
    const escapedHostname = hostname.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const originPattern = new RegExp(`https?://(?:www\\.)?${escapedHostname}(?=[/:?#\"'\\s<]|$)`, "giu");
    rewritten = rewritten.replace(originPattern, profile.previewOrigins[id]);

    // Some pages mention the public hostname as prose rather than as a URL.
    // Replace only a complete hostname, and never an email-domain occurrence.
    const hostnamePattern = new RegExp(
      `(^|[^A-Za-z0-9.@-])(?:www\\.)?${escapedHostname}(?![A-Za-z0-9-]|\\.[A-Za-z0-9])`,
      "giu"
    );
    const previewHostname = new URL(profile.previewOrigins[id]).hostname;
    rewritten = rewritten.replace(hostnamePattern, (_match, prefix) => `${prefix}${previewHostname}`);
  }
  return rewritten;
}

async function atomicReplace(file, contents) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomBytes(8).toString("hex")}.tmp`);
  try {
    await fsp.writeFile(temporary, contents, { flag: "wx", mode: 0o600 });
    await fsp.rename(temporary, file);
  } catch (error) {
    await fsp.unlink(temporary).catch(() => {});
    throw error;
  }
}

async function listFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const info = await fsp.lstat(full);
      if (info.isSymbolicLink()) throw new Error("Preview build contains a symbolic link.");
      if (info.isDirectory()) stack.push(full);
      else if (info.isFile()) files.push({ full, relative: path.relative(root, full).split(path.sep).join("/"), size: info.size });
      else throw new Error("Preview build contains a special file.");
    }
  }
  return files.sort((left, right) => left.relative.localeCompare(right.relative));
}

function validatePreviewHtml(value, profile, relative) {
  if (!value.includes(NOINDEX_TAG)) throw new Error(`Preview page is missing noindex: ${relative}.`);
  const canonicalTag = value.match(/<link\b(?=[^>]*\brel=["']canonical["'])(?=[^>]*\bhref=["']([^"']+)["'])[^>]*>/iu);
  if (!canonicalTag) throw new Error(`Preview page is missing canonical: ${relative}.`);
  let canonical;
  try { canonical = new URL(canonicalTag[1]); } catch { throw new Error(`Preview canonical is invalid: ${relative}.`); }
  if (canonical.origin !== profile.previewOrigins.lbi) throw new Error(`Preview canonical escaped its LBI origin: ${relative}.`);
}

export async function applyPreviewProfile({ outputDir, profile }) {
  if (!profile) return { enabled: false, htmlPages: 0, textFiles: 0 };
  const resolvedOutput = path.resolve(outputDir);
  const outputInfo = await fsp.lstat(resolvedOutput);
  if (!outputInfo.isDirectory() || outputInfo.isSymbolicLink()) throw new Error("Preview output root is unsafe.");
  const outputRoot = await fsp.realpath(resolvedOutput);
  if (normalizeCase(outputRoot) !== normalizeCase(resolvedOutput)) throw new Error("Preview output root may not traverse links.");
  for (const privateRoute of ["beheer", "admin"]) {
    await fsp.rm(path.join(outputRoot, privateRoute), { recursive: true, force: true });
  }
  const files = await listFiles(outputRoot);
  const forbiddenHosts = Object.values(profile.productionOrigins).map((origin) => new URL(origin).hostname.replace(/^www\./u, "").toLowerCase());
  let htmlPages = 0;
  let textFiles = 0;
  for (const file of files) {
    const extension = path.extname(file.full).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    if (file.size > MAX_TEXT_FILE_BYTES) throw new Error(`Preview text file is too large: ${file.relative}.`);
    let value = rewriteOrigins(await fsp.readFile(file.full, "utf8"), profile);
    if (extension === ".html") {
      const robots = /<meta\s+name=["']robots["'][^>]*>/giu;
      if (!robots.test(value)) throw new Error(`Preview page is missing robots metadata: ${file.relative}.`);
      value = value.replace(robots, NOINDEX_TAG);
      validatePreviewHtml(value, profile, file.relative);
      htmlPages += 1;
    }
    if (file.relative === "robots.txt") value = "User-agent: *\nDisallow: /\n";
    const lower = value.toLowerCase();
    if (forbiddenHosts.some((hostname) => lower.includes(hostname))) {
      throw new Error(`Production hostname escaped preview rewriting: ${file.relative}.`);
    }
    await atomicReplace(file.full, value);
    textFiles += 1;
  }
  const robots = await fsp.readFile(path.join(outputRoot, "robots.txt"), "utf8");
  if (robots !== "User-agent: *\nDisallow: /\n") throw new Error("Preview robots.txt is not deny-all.");
  if (!htmlPages) throw new Error("Preview build contains no HTML pages.");
  return { enabled: true, htmlPages, textFiles };
}

export async function removeEmbeddedProjectAdminFrontend(outputDir) {
  const resolvedOutput = path.resolve(outputDir);
  const outputInfo = await fsp.lstat(resolvedOutput);
  if (!outputInfo.isDirectory() || outputInfo.isSymbolicLink()) throw new Error("Publication output root is unsafe.");
  const outputRoot = await fsp.realpath(resolvedOutput);
  if (normalizeCase(outputRoot) !== normalizeCase(resolvedOutput)) throw new Error("Publication output root may not traverse links.");
  await fsp.rm(path.join(outputRoot, "beheer"), { recursive: true, force: true });
}
