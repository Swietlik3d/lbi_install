import fs from "node:fs";
import path from "node:path";
import { ensureDist, getSite } from "./content-utils.mjs";

const siteId = process.argv[2] || process.env.SITE_ID || "lbi";
const site = getSite(siteId);
const dist = ensureDist(siteId);
const sitemapUrl = new URL("/sitemap.xml", site.domain).toString();

const robots = `User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: ${sitemapUrl}\n`;

fs.writeFileSync(path.join(dist, "robots.txt"), robots);
console.log(`Generated robots.txt for ${siteId}`);
