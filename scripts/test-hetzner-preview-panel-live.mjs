#!/usr/bin/env node
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const ORIGIN = "https://lbi-preview.178-105-195-84.sslip.io";
const ACCESS_FILE = path.join(ROOT, ".artifacts", "hetzner-preview-access", "client-access.txt");
const PREFLIGHT_FILE = path.join(ROOT, "artifacts", "hetzner-preview-install", "panel-live-preflight.json");
const REPORT_FILE = path.join(ROOT, "artifacts", "hetzner-preview-install", "panel-live-e2e.json");
const API_ROOT = "/beheer/api";
const REQUEST_TIMEOUT_MS = 20_000;
const FINALIZATION_TIMEOUT_MS = 8_000;
const PUBLISH_TIMEOUT_MS = 5 * 60 * 1000;
const HARD_TIMEOUT_MS = 4 * 60 * 1000 + 20_000;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_HTML_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_SITEMAP_URLS = 1_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const COVER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/u;
const STATIC_RELEASE_RE = /^\d{8}T\d{6}Z$/u;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/u;
const SAFE_CODE_RE = /^[a-z0-9_.:-]{1,160}$/u;
const PRODUCTION_HOSTS = Object.freeze([
  "lbi-helmond.nl",
  "elektrastoring-helmond.nl",
  "lekkage-reparatie-helmond.nl",
  "gasleiding-service-helmond.nl",
]);

class LiveE2EError extends Error {
  constructor(code) {
    super(code);
    this.code = SAFE_CODE_RE.test(code) ? code : "unsafe_failure_code";
  }
}

function fail(code) {
  throw new LiveE2EError(code);
}

function check(condition, code) {
  if (!condition) fail(code);
}

function safeErrorCode(error) {
  if (error instanceof LiveE2EError) return error.code;
  if (error?.name === "AbortError" || error?.name === "TimeoutError") return "request_timeout";
  if (error?.code && SAFE_CODE_RE.test(String(error.code).toLowerCase())) return `runtime:${String(error.code).toLowerCase()}`;
  return "unexpected_runtime_failure";
}

function normalizePathCase(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function exactUrl(route) {
  check(typeof route === "string" && route.startsWith("/") && !route.startsWith("//"), "unsafe_request_path");
  const url = new URL(route, ORIGIN);
  check(url.origin === ORIGIN && !url.username && !url.password, "request_origin_escape");
  return url;
}

async function readBounded(response, maximum, code) {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximum)) fail(`${code}:declared_size`);
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        fail(`${code}:body_size`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

async function fetchBounded(route, options = {}, maximum = MAX_JSON_BYTES, finalization = false) {
  const url = route instanceof URL ? route : exactUrl(route);
  check(url.origin === ORIGIN, "fetch_origin_escape");
  const response = await fetch(url, {
    ...options,
    redirect: "manual",
    cache: "no-store",
    signal: finalization
      ? AbortSignal.timeout(FINALIZATION_TIMEOUT_MS)
      : AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), hardAbort.signal]),
  });
  if (response.status >= 300 && response.status < 400) fail(`unexpected_redirect:${response.status}`);
  const body = await readBounded(response, maximum, "response_too_large");
  return { response, body };
}

function parseJson(body, code) {
  let value;
  try {
    value = JSON.parse(body.toString("utf8"));
  } catch {
    fail(`${code}:invalid_json`);
  }
  check(value && typeof value === "object" && !Array.isArray(value), `${code}:invalid_shape`);
  return value;
}

function serverErrorCode(value) {
  const code = value?.error?.code;
  return typeof code === "string" && /^[a-z0-9_]{1,80}$/u.test(code) ? code : "unknown_error";
}

let sessionCookie = "";
let csrfToken = "";

async function api(route, {
  method = "GET",
  json,
  body,
  contentType,
  origin = method === "GET" ? undefined : ORIGIN,
  csrf = method === "GET" ? undefined : csrfToken,
  cookie = sessionCookie,
  expectedStatus = 200,
  finalization = false,
} = {}) {
  const headers = { Accept: "application/json" };
  if (origin !== undefined) headers.Origin = origin;
  if (csrf) headers["X-CSRF-Token"] = csrf;
  if (cookie) headers.Cookie = cookie;
  let requestBody = body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(json);
  } else if (contentType) {
    headers["Content-Type"] = contentType;
  }
  const result = await fetchBounded(`${API_ROOT}${route}`, { method, headers, body: requestBody }, MAX_JSON_BYTES, finalization);
  const value = parseJson(result.body, `api${route.replaceAll("/", ":") || ":root"}`);
  if (result.response.status !== expectedStatus) {
    fail(`api_status:${result.response.status}:${serverErrorCode(value)}`);
  }
  return { response: result.response, value };
}

async function readPassword() {
  const info = await fsp.lstat(ACCESS_FILE);
  check(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= 8 * 1024, "unsafe_access_file");
  const real = await fsp.realpath(ACCESS_FILE);
  check(normalizePathCase(real) === normalizePathCase(path.resolve(ACCESS_FILE)), "linked_access_file");
  const contents = await fsp.readFile(real, "utf8");
  check(contents.includes(`URL: ${ORIGIN}/beheer/projecten/`), "access_origin_mismatch");
  const matches = [...contents.matchAll(/^Wachtwoord: ([^\r\n]+)$/gmu)];
  check(matches.length === 1 && matches[0][1].length >= 12 && matches[0][1].length <= 512, "invalid_access_password_record");
  return matches[0][1];
}

async function readPreflight() {
  const info = await fsp.lstat(PREFLIGHT_FILE);
  check(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= 64 * 1024, "unsafe_preflight_file");
  const real = await fsp.realpath(PREFLIGHT_FILE);
  check(normalizePathCase(real) === normalizePathCase(path.resolve(PREFLIGHT_FILE)), "linked_preflight_file");
  const value = parseJson(await fsp.readFile(real), "preflight");
  check(JSON.stringify(Object.keys(value).sort()) === JSON.stringify(["beforeCurrent", "beforeProjectIds", "origin"]), "preflight_fields");
  check(value.origin === ORIGIN, "preflight_origin");
  check(Array.isArray(value.beforeProjectIds), "preflight_project_ids");
  const ids = [...value.beforeProjectIds].sort();
  check(ids.every((id) => typeof id === "string" && UUID_RE.test(id)), "preflight_project_id");
  check(new Set(ids).size === ids.length, "preflight_duplicate_id");
  const prefix = "/var/www/strony/lbi/releases/";
  check(typeof value.beforeCurrent === "string" && value.beforeCurrent.startsWith(prefix), "preflight_current_prefix");
  check(STATIC_RELEASE_RE.test(value.beforeCurrent.slice(prefix.length)), "preflight_current_release");
  return { beforeCurrent: value.beforeCurrent, beforeProjectIds: ids };
}

function projectIds(value, code) {
  check(Array.isArray(value?.projects), `${code}:projects_shape`);
  const ids = value.projects.map((project) => project?.id);
  check(ids.every((id) => typeof id === "string" && UUID_RE.test(id)), `${code}:project_id`);
  check(new Set(ids).size === ids.length, `${code}:duplicate_id`);
  return ids.sort();
}

function containsProductionHost(value) {
  const lower = value.toLowerCase();
  return PRODUCTION_HOSTS.some((hostname) => lower.includes(hostname));
}

function assertPreviewHtml(html, route) {
  check(!containsProductionHost(html), `production_host_in_html:${route.replaceAll("/", "_")}`);
  check(
    /<meta\b(?=[^>]*\bname=["']robots["'])(?=[^>]*\bcontent=["']noindex,nofollow,noarchive["'])[^>]*>/iu.test(html),
    `noindex_missing:${route.replaceAll("/", "_")}`
  );
  const match = html.match(/<link\b(?=[^>]*\brel=["']canonical["'])(?=[^>]*\bhref=["']([^"']+)["'])[^>]*>/iu);
  check(Boolean(match), `canonical_missing:${route.replaceAll("/", "_")}`);
  let canonical;
  try {
    canonical = new URL(match[1]);
  } catch {
    fail(`canonical_invalid:${route.replaceAll("/", "_")}`);
  }
  check(canonical.origin === ORIGIN, `canonical_origin:${route.replaceAll("/", "_")}`);
}

async function publicText(route, expectedContentType) {
  const result = await fetchBounded(route, { headers: { Accept: expectedContentType } }, MAX_HTML_BYTES);
  check(result.response.status === 200, `public_status:${result.response.status}:${route.replaceAll("/", "_")}`);
  const contentType = result.response.headers.get("content-type") ?? "";
  check(contentType.toLowerCase().includes(expectedContentType), `public_content_type:${route.replaceAll("/", "_")}`);
  return { response: result.response, text: result.body.toString("utf8") };
}

function extractSitemapUrls(xml) {
  check(!containsProductionHost(xml), "production_host_in_sitemap");
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1]);
  check(urls.length > 0 && urls.length <= MAX_SITEMAP_URLS, "sitemap_url_count");
  const parsed = urls.map((value) => {
    let url;
    try {
      url = new URL(value);
    } catch {
      fail("sitemap_invalid_url");
    }
    check(url.origin === ORIGIN && !url.username && !url.password && !url.search && !url.hash, "sitemap_origin_escape");
    return url;
  });
  check(new Set(parsed.map((url) => url.href)).size === parsed.length, "sitemap_duplicate_url");
  return parsed;
}

async function inspectSitemapPages(urls, publicMarker, privateMarker) {
  for (let index = 0; index < urls.length; index += 5) {
    const batch = urls.slice(index, index + 5);
    const pages = await Promise.all(batch.map(async (url) => {
      const result = await fetchBounded(url, { headers: { Accept: "text/html" } }, MAX_HTML_BYTES);
      check(result.response.status === 200, `sitemap_page_status:${result.response.status}`);
      check((result.response.headers.get("content-type") ?? "").toLowerCase().includes("text/html"), "sitemap_page_content_type");
      return { route: url.pathname, html: result.body.toString("utf8") };
    }));
    for (const page of pages) {
      assertPreviewHtml(page.html, page.route);
      check(!page.html.includes(privateMarker), `private_canary_exposed:${page.route.replaceAll("/", "_")}`);
      if (page.route === "/" || page.route === "/projecten/") {
        check(page.html.includes(publicMarker), `published_marker_missing:${page.route.replaceAll("/", "_")}`);
      }
    }
  }
}

function publicReleaseIdentity(response) {
  const candidates = [
    ["etag", response.headers.get("etag")],
    ["last-modified", response.headers.get("last-modified")],
  ];
  for (const [kind, value] of candidates) {
    if (value && /^[\x20-\x7e]{1,200}$/u.test(value)) return { kind, value };
  }
  return null;
}

async function syntheticJpeg() {
  const svg = Buffer.from(
    '<svg width="1280" height="800" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#16253d"/><rect x="40" y="40" width="1200" height="720" rx="28" fill="#f97316"/><text x="640" y="390" text-anchor="middle" font-family="Arial,sans-serif" font-size="112" font-weight="700" fill="#ffffff">QA PREVIEW</text><text x="640" y="500" text-anchor="middle" font-family="Arial,sans-serif" font-size="48" fill="#ffffff">SYNTHETISCHE TESTAFBEELDING</text></svg>',
    "utf8"
  );
  return sharp(svg, { limitInputPixels: 2_000_000 }).jpeg({ quality: 86, progressive: true }).toBuffer();
}

function nextProjectDate(projects) {
  const dates = projects.map((project) => project?.date).filter((date) => /^\d{4}-\d{2}-\d{2}$/u.test(date)).sort();
  const latest = dates.at(-1) ?? new Date().toISOString().slice(0, 10);
  const next = new Date(`${latest}T12:00:00Z`);
  check(!Number.isNaN(next.valueOf()), "project_date_invalid");
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

const hardAbort = new AbortController();
const hardTimer = setTimeout(() => hardAbort.abort(), HARD_TIMEOUT_MS);
hardTimer.unref?.();

const report = {
  status: "FAIL",
  checkedAt: null,
  origin: ORIGIN,
  beforeCurrent: null,
  phase: "initialize",
  failureCode: null,
  marker: null,
  projectId: null,
  draftId: null,
  cover: null,
  publishedAt: null,
  beforeProjectIds: null,
  afterProjectIds: null,
  publicCurrentReleaseIdentity: null,
  checks: {
    unauthenticatedRejected: false,
    wrongOriginRejected: false,
    wrongCsrfRejected: false,
    secureCookie: false,
    publicationSucceeded: false,
    homePublishedProject: false,
    timelinePublishedProject: false,
    privateCanaryExcluded: false,
    mediaServedAsWebp: false,
    robotsDenyAll: false,
    sitemapPreviewOnly: false,
    allSitemapPagesNoindex: false,
    productionHostsAbsent: false,
    logoutSucceeded: false,
    oldSessionRejected: false,
  },
};

let primaryFailure = null;
let password = null;
let publicMarker = "";
let privateMarker = "";
let preflight = null;

try {
  report.phase = "preflight";
  preflight = await readPreflight();
  report.beforeCurrent = preflight.beforeCurrent;
  report.marker = `LBI PREVIEW QA ${crypto.randomUUID()}`;

  report.phase = "unauthenticated";
  const unauthenticated = await api("/projects", { cookie: "", expectedStatus: 401 });
  check(serverErrorCode(unauthenticated.value) === "unauthorized", "unauthenticated_error_code");
  report.checks.unauthenticatedRejected = true;

  report.phase = "credentials";
  password = await readPassword();
  report.phase = "login";
  const login = await api("/login", {
    method: "POST",
    json: { password },
    cookie: "",
    csrf: "",
  });
  password = null;
  check(login.value.authenticated === true && TOKEN_RE.test(login.value.csrfToken ?? ""), "login_response_invalid");
  const setCookie = login.response.headers.get("set-cookie") ?? "";
  const segments = setCookie.split(";").map((value) => value.trim());
  check(/^__Host-lbi_admin_session=[A-Za-z0-9_-]{43}$/u.test(segments[0] ?? ""), "session_cookie_invalid");
  const attributes = new Set(segments.slice(1).map((value) => value.toLowerCase()));
  check(attributes.has("path=/"), "session_cookie_path");
  check(attributes.has("httponly"), "session_cookie_httponly");
  check(attributes.has("samesite=strict"), "session_cookie_samesite");
  check(attributes.has("secure"), "session_cookie_secure");
  check(!segments.slice(1).some((value) => /^domain=/iu.test(value)), "session_cookie_domain");
  sessionCookie = segments[0];
  csrfToken = login.value.csrfToken;
  report.checks.secureCookie = true;

  publicMarker = `${report.marker} - PUBLISHED PROJECT`;
  privateMarker = `${report.marker} - PRIVATE CANARY - NIET PUBLICEREN`;
  const rejectedDraft = {
    title: `${report.marker} - REJECTED MUTATION`,
    category: "QA-test",
    location: "Synthetische QA",
    date: "",
    summary: "Deze mutatie moet door de beveiligingscontrole worden geweigerd.",
    coverAlt: "",
    body: "",
    cover: "",
  };

  report.phase = "csrf-origin";
  const wrongOrigin = await api("/projects", {
    method: "POST",
    json: rejectedDraft,
    origin: "https://invalid-origin.example",
    expectedStatus: 403,
  });
  check(serverErrorCode(wrongOrigin.value) === "invalid_origin", "wrong_origin_error_code");
  report.checks.wrongOriginRejected = true;
  const wrongCsrf = await api("/projects", {
    method: "POST",
    json: rejectedDraft,
    csrf: "invalid-csrf-token",
    expectedStatus: 403,
  });
  check(serverErrorCode(wrongCsrf.value) === "invalid_csrf", "wrong_csrf_error_code");
  report.checks.wrongCsrfRejected = true;

  report.phase = "inventory-before";
  const before = await api("/projects");
  report.beforeProjectIds = projectIds(before.value, "before");
  check(JSON.stringify(report.beforeProjectIds) === JSON.stringify(preflight.beforeProjectIds), "preflight_inventory_changed");
  const publishDate = nextProjectDate(before.value.projects);

  report.phase = "upload";
  const jpeg = await syntheticJpeg();
  check(jpeg.length > 0 && jpeg.length <= 10 * 1024 * 1024, "synthetic_jpeg_size");
  const upload = await api("/media", {
    method: "POST",
    body: jpeg,
    contentType: "image/jpeg",
    expectedStatus: 201,
  });
  check(COVER_RE.test(upload.value.cover ?? ""), "upload_cover_invalid");
  check(upload.value.url === `${API_ROOT}/media/${upload.value.cover}`, "upload_url_invalid");
  report.cover = upload.value.cover;

  report.phase = "create-published-project";
  const published = await api("/projects", {
    method: "POST",
    json: {
      title: publicMarker,
      category: "QA-test",
      location: "Synthetische previewcontrole",
      date: publishDate,
      summary: "Onmiskenbaar synthetisch QA-project voor een eenmalige live preview-publicatietest.",
      coverAlt: "Synthetische oranje QA PREVIEW-testafbeelding, geen klantfoto.",
      body: "Interne synthetische QA-notitie; deze tekst mag niet in de publieke build verschijnen.",
      cover: report.cover,
    },
  });
  check(UUID_RE.test(published.value?.project?.id ?? ""), "published_project_id_invalid");
  check(published.value.project.status === "concept", "published_project_initial_status");
  report.projectId = published.value.project.id;

  report.phase = "create-private-canary";
  const canary = await api("/projects", {
    method: "POST",
    json: {
      title: privateMarker,
      category: "QA-prive",
      location: "",
      date: "",
      summary: "Prive synthetische canary; dit concept mag nergens publiek verschijnen.",
      coverAlt: "",
      body: "PRIVATE QA CANARY - NIET PUBLICEREN",
      cover: "",
    },
  });
  check(UUID_RE.test(canary.value?.project?.id ?? ""), "canary_project_id_invalid");
  check(canary.value.project.status === "concept", "canary_project_status");
  report.draftId = canary.value.project.id;

  report.phase = "publish";
  const started = await api("/publish", {
    method: "POST",
    json: { id: report.projectId },
    expectedStatus: 202,
  });
  check(started.value?.publication?.state === "publishing", "publication_not_started");
  check(started.value.publication.projectId === report.projectId, "publication_start_id");
  const publicationDeadline = Date.now() + PUBLISH_TIMEOUT_MS;
  let publication = started.value.publication;
  while (publication.state === "publishing" && Date.now() < publicationDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    publication = (await api("/publication")).value.publication;
  }
  check(publication?.state !== "publishing", "publication_timeout");
  check(publication?.state === "success", `publication_state:${String(publication?.state ?? "missing").toLowerCase()}`);
  check(publication.projectId === report.projectId, "publication_result_id");
  check(typeof publication.publishedAt === "string" && !Number.isNaN(Date.parse(publication.publishedAt)), "publication_timestamp");
  report.publishedAt = publication.publishedAt;
  report.checks.publicationSucceeded = true;

  report.phase = "inventory-after";
  const after = await api("/projects");
  report.afterProjectIds = projectIds(after.value, "after");
  const publishedRecord = after.value.projects.find((project) => project.id === report.projectId);
  const canaryRecord = after.value.projects.find((project) => project.id === report.draftId);
  check(publishedRecord?.status === "gepubliceerd" && publishedRecord.publishedAt === report.publishedAt, "published_record_state");
  check(canaryRecord?.status === "concept" && !canaryRecord.publishedAt, "canary_record_state");
  check(!report.beforeProjectIds.includes(report.projectId), "published_id_preexisting");
  check(!report.beforeProjectIds.includes(report.draftId), "canary_id_preexisting");

  report.phase = "public-site";
  const [home, timeline, robots, sitemap] = await Promise.all([
    publicText("/", "text/html"),
    publicText("/projecten/", "text/html"),
    publicText("/robots.txt", "text/plain"),
    publicText("/sitemap.xml", "xml"),
  ]);
  assertPreviewHtml(home.text, "/");
  assertPreviewHtml(timeline.text, "/projecten/");
  check(home.text.includes(publicMarker) && home.text.includes(`client-${report.projectId}`), "home_project_missing");
  check(timeline.text.includes(publicMarker) && timeline.text.includes(`client-${report.projectId}`), "timeline_project_missing");
  check(home.text.includes(report.cover) && timeline.text.includes(report.cover), "public_cover_reference_missing");
  check(!home.text.includes(privateMarker) && !timeline.text.includes(privateMarker), "private_canary_exposed_primary_pages");
  report.checks.homePublishedProject = true;
  report.checks.timelinePublishedProject = true;
  report.checks.privateCanaryExcluded = true;
  report.publicCurrentReleaseIdentity = publicReleaseIdentity(home.response);

  check(robots.text === "User-agent: *\nDisallow: /\n", "robots_not_deny_all");
  check(!containsProductionHost(robots.text), "production_host_in_robots");
  report.checks.robotsDenyAll = true;
  const sitemapUrls = extractSitemapUrls(sitemap.text);
  check(sitemapUrls.some((url) => url.pathname === "/"), "sitemap_home_missing");
  check(sitemapUrls.some((url) => url.pathname === "/projecten/"), "sitemap_projects_missing");
  report.checks.sitemapPreviewOnly = true;
  await inspectSitemapPages(sitemapUrls, publicMarker, privateMarker);
  report.checks.allSitemapPagesNoindex = true;
  report.checks.productionHostsAbsent = true;

  report.phase = "media";
  const media = await fetchBounded(`/images/projects/client/${report.cover}`, { headers: { Accept: "image/webp" } }, MAX_IMAGE_BYTES);
  check(media.response.status === 200, `media_status:${media.response.status}`);
  check((media.response.headers.get("content-type") ?? "").toLowerCase().includes("image/webp"), "media_content_type");
  check(media.body.length >= 12 && media.body.subarray(0, 4).toString("ascii") === "RIFF" && media.body.subarray(8, 12).toString("ascii") === "WEBP", "media_webp_signature");
  report.checks.mediaServedAsWebp = true;

  report.phase = "complete";
} catch (error) {
  primaryFailure = safeErrorCode(error);
} finally {
  password = null;
  if (sessionCookie && csrfToken) {
    if (report.afterProjectIds === null) {
      try {
        const finalInventory = await api("/projects", { finalization: true });
        report.afterProjectIds = projectIds(finalInventory.value, "failure-after");
      } catch {
        // The failure report still retains every owned identifier already returned.
      }
    }
    try {
      const logout = await api("/logout", { method: "POST", json: {}, finalization: true });
      check(logout.value.authenticated === false, "logout_response_invalid");
      report.checks.logoutSucceeded = true;
      const staleSession = await api("/session", { cookie: sessionCookie, finalization: true });
      check(staleSession.value.authenticated === false && !("csrfToken" in staleSession.value), "old_session_still_authenticated");
      const staleProjects = await api("/projects", { cookie: sessionCookie, expectedStatus: 401, finalization: true });
      check(serverErrorCode(staleProjects.value) === "unauthorized", "old_session_projects_error_code");
      report.checks.oldSessionRejected = true;
    } catch (error) {
      if (!primaryFailure) primaryFailure = `logout:${safeErrorCode(error)}`;
    }
  } else if (!primaryFailure) {
    primaryFailure = "logout:no_session";
  }
  sessionCookie = "";
  csrfToken = "";
  clearTimeout(hardTimer);
  report.checkedAt = new Date().toISOString();
  report.failureCode = primaryFailure;
  report.status = primaryFailure ? "FAIL" : "PASS";
  if (!primaryFailure) report.phase = "complete";
  await fsp.mkdir(path.dirname(REPORT_FILE), { recursive: true });
  const temporary = `${REPORT_FILE}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await fsp.rename(temporary, REPORT_FILE);
}

if (primaryFailure) {
  console.error(`FAIL hetzner preview panel live E2E (${primaryFailure}); report: ${path.relative(ROOT, REPORT_FILE)}`);
  process.exitCode = 1;
} else {
  console.log(`PASS hetzner preview panel live E2E; report: ${path.relative(ROOT, REPORT_FILE)}`);
}
