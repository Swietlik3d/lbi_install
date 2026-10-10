#!/usr/bin/env node
import { createProjectAdmin } from "./app.mjs";

if (!Number.isInteger(Number(process.versions.node.split(".")[0])) || Number(process.versions.node.split(".")[0]) < 22) {
  console.error("Project admin requires Node.js 22 or newer.");
  process.exit(1);
}

let app;
try {
  app = await createProjectAdmin();
  const address = await app.listen();
  console.log(`[project-admin] listening on 127.0.0.1:${address.port}`);
} catch (error) {
  console.error(`[project-admin] startup failed: ${error?.message ?? "unknown error"}`);
  process.exit(1);
}

async function shutdown() {
  await app.close().catch(() => {});
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
