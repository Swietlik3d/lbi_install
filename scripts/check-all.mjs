import { execSync } from "node:child_process";
import { ROOT, SITE_IDS } from "./_sites.mjs";

/**
 * Runs `astro check` (TypeScript + Astro diagnostics) once per site, since the
 * active content set depends on SITE_ID.
 */
let failed = 0;
for (const id of SITE_IDS) {
  console.log(`\n▶  astro check (SITE_ID=${id})`);
  try {
    execSync("npx astro check", {
      stdio: "inherit",
      cwd: ROOT,
      env: { ...process.env, SITE_ID: id },
    });
  } catch (err) {
    failed++;
    console.error(`✗  Check failed for "${id}"`);
  }
}

if (failed > 0) process.exit(1);
console.log("\n✓  Type check passed for all sites.");
