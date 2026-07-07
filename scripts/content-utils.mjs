import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { getSiteById, getSiteIds } from "../src/config/site-data.mjs";

const root = process.cwd();

export function assertSiteId(siteId) {
  if (!getSiteIds().includes(siteId)) {
    throw new Error(
      `Unknown site "${siteId}". Expected one of: ${getSiteIds().join(", ")}`,
    );
  }
}

export function getSite(siteId) {
  assertSiteId(siteId);
  return getSiteById(siteId);
}

export function readPages(siteId) {
  assertSiteId(siteId);
  const dir = path.join(root, "src", "content", "pages", siteId);
  const files = fs.readdirSync(dir).filter((file) => file.endsWith(".md"));

  return files
    .map((file) => {
      const fullPath = path.join(dir, file);
      const source = fs.readFileSync(fullPath, "utf8");
      const { data } = matter(source);
      return {
        file,
        path: data.path,
        draft: Boolean(data.draft),
      };
    })
    .filter((page) => page.path && !page.draft)
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function ensureDist(siteId) {
  const dist = path.join(root, "dist", siteId);
  fs.mkdirSync(dist, { recursive: true });
  return dist;
}

export function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
