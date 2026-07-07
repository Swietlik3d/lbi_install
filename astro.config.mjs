import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import { getSiteById, getSiteIds } from "./src/config/site-data.mjs";

const siteId = process.env.SITE_ID || "lbi";

if (!getSiteIds().includes(siteId)) {
  throw new Error(
    `Unknown SITE_ID "${siteId}". Expected one of: ${getSiteIds().join(", ")}`,
  );
}

const site = getSiteById(siteId);

export default defineConfig({
  site: site.domain,
  output: "static",
  outDir: `./dist/${siteId}`,
  integrations: [
    tailwind({
      applyBaseStyles: false,
    }),
  ],
  vite: {
    define: {
      "import.meta.env.PUBLIC_SITE_ID": JSON.stringify(siteId),
    },
  },
});
