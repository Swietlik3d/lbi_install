import fs from "node:fs";
import path from "node:path";
import { ensureDist, getSite, readPages, xmlEscape } from "./content-utils.mjs";

const siteId = process.argv[2] || process.env.SITE_ID || "lbi";
const site = getSite(siteId);
const pages = readPages(siteId);
const dist = ensureDist(siteId);

const urls = pages
  .map((page) => {
    const loc = new URL(page.path, site.domain).toString();
    return `  <url>\n    <loc>${xmlEscape(loc)}</loc>\n  </url>`;
  })
  .join("\n");

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;

fs.writeFileSync(path.join(dist, "sitemap.xml"), sitemap);
console.log(`Generated sitemap for ${siteId}: ${pages.length} URLs`);
