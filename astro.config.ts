import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
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
  trailingSlash: "always",
  devToolbar: {
    enabled: false,
  },
  build: {
    format: "directory",
    inlineStylesheets: "auto",
  },
  prefetch: false,
  integrations: [
    tailwind({
      // We import the Tailwind entrypoint ourselves in global.css so we can
      // add base layers and per-site theme variables.
      applyBaseStyles: false,
    }),
  ],
  compressHTML: true,
});
