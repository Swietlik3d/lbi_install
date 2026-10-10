#!/usr/bin/env node
import { createBuilderServer, formatBuilderDiagnostic } from "./isolated-builder.mjs";

if (!Number.isInteger(Number(process.versions.node.split(".")[0])) || Number(process.versions.node.split(".")[0]) < 22) {
  console.error("Project builder requires Node.js 22 or newer.");
  process.exit(1);
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

let builder;
try {
  const sourceDir = required("LBI_BUILDER_SOURCE_DIR");
  const requestRoot = required("LBI_BUILDER_REQUEST_DIR");
  const workspaceRoot = required("LBI_BUILDER_WORKSPACE_DIR");
  const socketPath = required("LBI_BUILDER_SOCKET");
  builder = await createBuilderServer({
    sourceDir,
    requestRoot,
    workspaceRoot,
    socketPath,
    onError(error) {
      console.error(`[project-builder] job failed ${formatBuilderDiagnostic(error, {
        paths: [sourceDir, requestRoot, workspaceRoot, socketPath],
      })}`);
    },
  });
  console.log("[project-builder] isolated builder socket ready");
} catch (error) {
  console.error(`[project-builder] startup failed: ${error?.message ?? "unknown error"}`);
  process.exit(1);
}

async function shutdown() {
  await builder.close().catch(() => {});
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
