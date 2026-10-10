import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, readSites } from "./_sites.mjs";

/**
 * Generates dist/<site>/sitemap.xml by scanning the built HTML output.
 * Every directory containing an index.html becomes one URL. 404 and /admin
 * are excluded.
 */
export function generateSitemap({ distDir, domain }) {
  if (!fs.existsSync(distDir)) {
    throw new Error(`Build output not found: ${distDir}`);
  }

  const routes = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === "index.html") {
        const rel = path.relative(distDir, path.dirname(full)).split(path.sep).join("/");
        routes.push(rel === "" ? "/" : `/${rel}/`);
      }
    }
  }
  walk(distDir);

  const filtered = routes
    .filter((u) => !u.startsWith("/admin"))
    .filter((u) => !u.startsWith("/beheer"))
    .filter((u) => !u.startsWith("/404"))
    .sort();

  const today = new Date().toISOString().slice(0, 10);
  const urlEntries = filtered
    .map(
      (u) =>
        `  <url>\n    <loc>${domain}${u}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries}\n</urlset>\n`;

  fs.writeFileSync(path.join(distDir, "sitemap.xml"), xml, "utf8");
  console.log(`  sitemap.xml (${filtered.length} URLs)`);
  return filtered.length;
}

// Standalone: `SITE_ID=lbi node scripts/generate-sitemap.mjs`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const siteId = process.env.SITE_ID || "lbi";
  const sites = readSites();
  const site = sites[siteId];
  if (!site) {
    console.error(`Unknown SITE_ID: ${siteId}`);
    process.exit(1);
  }
  generateSitemap({ distDir: path.join(ROOT, "dist", siteId), domain: site.domain });
}
