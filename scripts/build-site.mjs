import { execSync } from "node:child_process";
import path from "node:path";
import { ROOT, SITE_IDS, readSites } from "./_sites.mjs";
import { generateSitemap } from "./generate-sitemap.mjs";
import { generateRobots } from "./generate-robots.mjs";

/**
 * Builds ONE site:
 *   node scripts/build-site.mjs <lbi|elektra|lekkage|gas>
 * Runs `astro build` with SITE_ID set (so astro.config.ts picks the right
 * domain + outDir), then writes sitemap.xml and robots.txt into dist/<site>.
 */
const siteId = process.argv[2];

if (!siteId || !SITE_IDS.includes(siteId)) {
  console.error(`Usage: node scripts/build-site.mjs <${SITE_IDS.join("|")}>`);
  process.exit(1);
}

const sites = readSites();
const site = sites[siteId];
const env = { ...process.env, SITE_ID: siteId };
const distDir = path.join(ROOT, "dist", siteId);

console.log(`\n▶  Building "${siteId}"  →  ${site.domain}`);
execSync("npx astro build", { stdio: "inherit", env, cwd: ROOT });

generateSitemap({ distDir, domain: site.domain });
generateRobots({ distDir, domain: site.domain });

console.log(`✓  Finished "${siteId}"  →  dist/${siteId}\n`);
