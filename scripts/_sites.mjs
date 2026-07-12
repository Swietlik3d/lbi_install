import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the repo root (one level up from /scripts). */
export const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Build order / known sites. */
export const SITE_IDS = ["lbi", "elektra", "lekkage", "gas"];

/** Read the shared site registry (same file the TS app imports). */
export function readSites() {
  const p = path.join(ROOT, "src", "config", "sites.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
