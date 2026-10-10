import { defineConfig } from "astro/config";
import tailwind from "@tailwindcss/vite";
import { SITES, resolveSiteId } from "./src/config/sites";

// The active site is selected at build time via the SITE_ID environment
// variable (lbi | elektra | lekkage | gas). Each build is a fully separate
// static site with its own domain and output directory.
const siteId = resolveSiteId(process.env.SITE_ID);
const activeSite = SITES[siteId];

// https://astro.build/config
export default defineConfig({
  site: activeSite.domain,
  outDir: `./dist/${siteId}`,
  cacheDir: process.env.ASTRO_CACHE_DIR || "./.astro/cache",
  trailingSlash: "always",
  devToolbar: {
    enabled: false,
  },
  build: {
    format: "directory",
    inlineStylesheets: "auto",
  },
  prefetch: false,
  vite: {
    plugins: [tailwind()],
    // The isolated builder supplies a cache inside its disposable workspace.
    cacheDir: process.env.LBI_VITE_CACHE_DIR || "./node_modules/.vite",
  },
  compressHTML: true,
});
