import { spawnSync } from "node:child_process";
import { getSiteIds } from "../src/config/site-data.mjs";

for (const siteId of getSiteIds()) {
  console.log(`\nBuilding ${siteId}...\n`);
  const result = spawnSync("npm", ["run", `build:${siteId}`], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      SITE_ID: siteId,
    },
  });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("\nAll sites built successfully.");
