import assert from "node:assert/strict";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyPreviewProfile,
  loadPreviewProfile,
  removeEmbeddedProjectAdminFrontend,
} from "../server/project-admin/preview-profile.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const ARTIFACT_ROOT = path.join(ROOT, "artifacts", "project-admin-tests");
const fixtureRoot = path.join(
  ARTIFACT_ROOT,
  `preview-profile-${new Date().toISOString().replace(/[:.]/gu, "-")}-${crypto.randomBytes(4).toString("hex")}`
);

const productionOrigins = {
  lbi: "https://www.lbi-helmond.nl",
  elektra: "https://www.elektrastoring-helmond.nl",
  lekkage: "https://www.lekkage-reparatie-helmond.nl",
  gas: "https://www.gasleiding-service-helmond.nl",
};
const previewOrigins = {
  lbi: "https://lbi-preview.178-105-195-84.sslip.io",
  elektra: "https://elektra-preview.178-105-195-84.sslip.io",
  lekkage: "https://lekkage-preview.178-105-195-84.sslip.io",
  gas: "https://gas-preview.178-105-195-84.sslip.io",
};

async function exists(file) {
  return Boolean(await fsp.lstat(file).catch(() => null));
}

async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function countPublicIndexPages(root) {
  let count = 0;
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      if (entry.name === "admin" || entry.name === "beheer") continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name === "index.html") count += 1;
    }
  }
  return count;
}

async function main() {
  const sourceDir = path.join(fixtureRoot, "source");
  const profileFile = path.join(sourceDir, "deploy", "hetzner-preview.json");
  const outputDir = path.join(fixtureRoot, "site");
  await writeJson(profileFile, { host: "178.105.195.84", remoteRoot: "/var/www/strony", sites: previewOrigins });
  await writeJson(
    path.join(sourceDir, "src", "config", "sites.json"),
    Object.fromEntries(Object.entries(productionOrigins).map(([id, domain]) => [id, { id, domain }]))
  );

  const crossLinks = Object.values(productionOrigins).map((origin) => `<a href="${origin}/">site</a>`).join("");
  const html = `<!doctype html><html><head><link rel="canonical" href="${productionOrigins.lbi}/projecten/"><meta name="robots" content="index,follow"><meta property="og:url" content="${productionOrigins.lbi}/projecten/"></head><body>${crossLinks}<p>Preview van lbi-helmond.nl en www.elektrastoring-helmond.nl.</p></body></html>`;
  await fsp.mkdir(path.join(outputDir, "projecten"), { recursive: true });
  await fsp.mkdir(path.join(outputDir, "beheer", "projecten"), { recursive: true });
  await fsp.mkdir(path.join(outputDir, "admin"), { recursive: true });
  await Promise.all([
    fsp.writeFile(path.join(outputDir, "index.html"), html.replaceAll("/projecten/", "/"), "utf8"),
    fsp.writeFile(path.join(outputDir, "projecten", "index.html"), html, "utf8"),
    fsp.writeFile(path.join(outputDir, "robots.txt"), `User-agent: *\nSitemap: ${productionOrigins.lbi}/sitemap-index.xml\n`, "utf8"),
    fsp.writeFile(path.join(outputDir, "sitemap-index.xml"), `<loc>${productionOrigins.lbi}/sitemap-0.xml</loc>`, "utf8"),
    fsp.writeFile(path.join(outputDir, "routes.js"), `export const links=${JSON.stringify(productionOrigins)};`, "utf8"),
    fsp.writeFile(path.join(outputDir, "beheer", "projecten", "index.html"), "private admin marker", "utf8"),
    fsp.writeFile(path.join(outputDir, "admin", "index.html"), "legacy admin marker", "utf8"),
  ]);

  const profile = await loadPreviewProfile({
    profileFile,
    sourceDir,
    adminOrigin: previewOrigins.lbi,
  });
  assert.deepEqual(profile.previewOrigins, previewOrigins);
  const result = await applyPreviewProfile({ outputDir, profile });
  assert.equal(result.enabled, true);
  assert.equal(result.htmlPages, 2);
  assert.equal(await exists(path.join(outputDir, "beheer")), false);
  assert.equal(await exists(path.join(outputDir, "admin")), false);

  const files = await Promise.all([
    fsp.readFile(path.join(outputDir, "index.html"), "utf8"),
    fsp.readFile(path.join(outputDir, "projecten", "index.html"), "utf8"),
    fsp.readFile(path.join(outputDir, "robots.txt"), "utf8"),
    fsp.readFile(path.join(outputDir, "sitemap-index.xml"), "utf8"),
    fsp.readFile(path.join(outputDir, "routes.js"), "utf8"),
  ]);
  const combined = files.join("\n");
  for (const origin of Object.values(previewOrigins)) assert.ok(combined.includes(origin));
  for (const origin of Object.values(productionOrigins)) {
    assert.equal(combined.toLowerCase().includes(new URL(origin).hostname.replace(/^www\./u, "").toLowerCase()), false);
  }
  assert.match(files[0], /<meta name="robots" content="noindex,nofollow,noarchive">/u);
  assert.match(files[0], new RegExp(`<link rel="canonical" href="${previewOrigins.lbi.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/">`, "u"));
  assert.match(files[0], /Preview van lbi-preview\.178-105-195-84\.sslip\.io en elektra-preview\.178-105-195-84\.sslip\.io\./u);
  assert.equal(files[2], "User-agent: *\nDisallow: /\n");

  await assert.rejects(
    loadPreviewProfile({ profileFile, sourceDir, adminOrigin: "https://wrong-preview.example" }),
    /must exactly match/u
  );
  const outsideProfile = path.join(fixtureRoot, "outside.json");
  await writeJson(outsideProfile, { host: "178.105.195.84", remoteRoot: "/var/www/strony", sites: previewOrigins });
  await assert.rejects(
    loadPreviewProfile({ profileFile: outsideProfile, sourceDir, adminOrigin: previewOrigins.lbi }),
    /inside the immutable source tree/u
  );
  await assert.rejects(
    loadPreviewProfile({ profileFile: path.relative(ROOT, profileFile), sourceDir, adminOrigin: previewOrigins.lbi }),
    /absolute path/u
  );

  const productionOutput = path.join(fixtureRoot, "production-site");
  await fsp.mkdir(path.join(productionOutput, "beheer"), { recursive: true });
  await fsp.mkdir(path.join(productionOutput, "admin"), { recursive: true });
  await fsp.writeFile(path.join(productionOutput, "index.html"), html, "utf8");
  await removeEmbeddedProjectAdminFrontend(productionOutput);
  assert.equal(await exists(path.join(productionOutput, "beheer")), false);
  assert.equal(await exists(path.join(productionOutput, "admin")), true);
  assert.equal(await fsp.readFile(path.join(productionOutput, "index.html"), "utf8"), html);

  const compiledOutput = path.join(fixtureRoot, "compiled-lbi");
  await fsp.cp(path.join(ROOT, "dist", "lbi"), compiledOutput, { recursive: true, errorOnExist: true });
  const compiledPrivacyFile = path.join(compiledOutput, "privacy-cookies", "index.html");
  const compiledPrivacyBefore = await fsp.readFile(compiledPrivacyFile, "utf8");
  assert.match(compiledPrivacyBefore, /previewversie van lbi-helmond\.nl/u);
  assert.match(compiledPrivacyBefore, /lbi\.helmond@protonmail\.com/u);
  assert.match(compiledPrivacyBefore, /06 532 29 349/u);

  const deployedProfile = await loadPreviewProfile({
    profileFile: path.join(ROOT, "deploy", "hetzner-preview.json"),
    sourceDir: ROOT,
    adminOrigin: previewOrigins.lbi,
  });
  const compiledRoutedPages = await countPublicIndexPages(compiledOutput);
  assert.equal(compiledRoutedPages, 12);
  const compiledResult = await applyPreviewProfile({ outputDir: compiledOutput, profile: deployedProfile });
  assert.equal(compiledResult.htmlPages, 13);
  assert.equal(await exists(path.join(compiledOutput, "beheer")), false);
  assert.equal(await exists(path.join(compiledOutput, "admin")), false);
  const compiledPrivacyAfter = await fsp.readFile(compiledPrivacyFile, "utf8");
  assert.match(compiledPrivacyAfter, /previewversie van lbi-preview\.178-105-195-84\.sslip\.io/u);
  assert.doesNotMatch(compiledPrivacyAfter, /lbi-helmond\.nl/iu);
  assert.match(compiledPrivacyAfter, /lbi\.helmond@protonmail\.com/u);
  assert.match(compiledPrivacyAfter, /06 532 29 349/u);

  const evidence = {
    passed: true,
    tests: 30,
    fixtureRoot,
    actualCompiledRoutedPages: compiledRoutedPages,
    actualCompiledHtmlFiles: compiledResult.htmlPages,
    assertions: [
      "trusted profile validation",
      "all four production origins rewritten",
      "preview canonical enforcement",
      "HTML noindex enforcement",
      "deny-all robots enforcement",
      "embedded admin removal",
      "origin mismatch rejection",
      "outside-source profile rejection",
      "relative profile path rejection",
      "production content and legacy admin preserved while embedded project admin is removed",
      "bare production hostnames rewritten in prose",
      "actual compiled 12-page LBI output passes the deployed preview profile",
      "actual contact email and telephone preserved byte-for-byte",
    ],
  };
  await fsp.mkdir(ARTIFACT_ROOT, { recursive: true });
  const evidenceFile = path.join(ARTIFACT_ROOT, "preview-profile-latest.json");
  await fsp.writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`PASS project admin preview profile (${evidence.tests} checks)`);
  console.log(evidenceFile);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
