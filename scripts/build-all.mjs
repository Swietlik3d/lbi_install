import { execSync } from "node:child_process";
import { ROOT, SITE_IDS } from "./_sites.mjs";

/**
 * Builds all four sites sequentially into dist/lbi, dist/elektra,
 * dist/lekkage and dist/gas. Each site is a separate, fully static build.
 */
console.log(`\n■  Building all sites: ${SITE_IDS.join(", ")}`);

let failed = 0;
for (const id of SITE_IDS) {
  try {
    execSync(`node scripts/build-site.mjs ${id}`, { stdio: "inherit", cwd: ROOT });
  } catch (err) {
    failed++;
    console.error(`✗  Build failed for "${id}": ${err.message}`);
  }
}

if (failed > 0) {
  console.error(`\n■  Done with ${failed} failed build(s).`);
  process.exit(1);
}
console.log("\n■  All sites built successfully.");
