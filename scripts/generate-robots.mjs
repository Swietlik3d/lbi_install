import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, readSites } from "./_sites.mjs";

/** Generates dist/<site>/robots.txt pointing at that site's own sitemap. */
export function generateRobots({ distDir, domain }) {
  if (!fs.existsSync(distDir)) {
    throw new Error(`Build output not found: ${distDir}`);
  }
  const txt = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin/",
    "",
    `Sitemap: ${domain}/sitemap.xml`,
    "",
  ].join("\n");

  fs.writeFileSync(path.join(distDir, "robots.txt"), txt, "utf8");
  console.log("  robots.txt");
}

// Standalone: `SITE_ID=lbi node scripts/generate-robots.mjs`
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const siteId = process.env.SITE_ID || "lbi";
  const sites = readSites();
  const site = sites[siteId];
  if (!site) {
    console.error(`Unknown SITE_ID: ${siteId}`);
    process.exit(1);
  }
  generateRobots({ distDir: path.join(ROOT, "dist", siteId), domain: site.domain });
}
