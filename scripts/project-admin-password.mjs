#!/usr/bin/env node
import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createPasswordRecord } from "../server/project-admin/security.mjs";

const SOURCE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function usage() {
  console.error("Usage: node scripts/project-admin-password.mjs [--force] <absolute-password-hash-file>");
}

async function hiddenPrompt(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Interactive prompt requires a TTY.");
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (character) => {
      if (character === "\u0003") return finish(new Error("Cancelled."));
      if (character === "\r" || character === "\n") return finish();
      if (character === "\u007f" || character === "\b") {
        value = value.slice(0, -1);
        return;
      }
      if (!/[\u0000-\u001f]/u.test(character)) value += character;
    };
    process.stdin.on("data", onData);
  });
}

async function readPassword() {
  if (process.stdin.isTTY) {
    const first = await hiddenPrompt("New admin password: ");
    const second = await hiddenPrompt("Repeat admin password: ");
    if (first !== second) throw new Error("Passwords do not match.");
    return first;
  }
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  if (input.length > 4096) throw new Error("Password input is too large.");
  const lines = input.replace(/\r/gu, "").split("\n").filter((line, index, list) => !(index === list.length - 1 && line === ""));
  if (lines.length !== 1) throw new Error("Standard input must contain exactly one password line.");
  return lines[0];
}

const args = process.argv.slice(2);
const forceIndex = args.indexOf("--force");
const force = forceIndex !== -1;
if (force) args.splice(forceIndex, 1);
if (args.length !== 1 || !path.isAbsolute(args[0])) {
  usage();
  process.exit(2);
}

const target = path.resolve(args[0]);
const directory = path.dirname(target);
const configuredSource = path.resolve(process.env.LBI_ADMIN_SOURCE_DIR || SOURCE_ROOT);
const configuredPublish = process.env.LBI_ADMIN_PUBLISH_ROOT ? path.resolve(process.env.LBI_ADMIN_PUBLISH_ROOT) : null;
const configuredData = process.env.LBI_ADMIN_DATA_DIR ? path.resolve(process.env.LBI_ADMIN_DATA_DIR) : null;
if (isWithin(configuredSource, target) || (configuredPublish && isWithin(configuredPublish, target))) {
  throw new Error("Password hash file must be outside source and published web roots.");
}
if (configuredData && !isWithin(configuredData, target)) {
  throw new Error("Password hash file must be inside LBI_ADMIN_DATA_DIR.");
}
await fs.mkdir(directory, { recursive: true, mode: 0o700 });
const realDirectory = await fs.realpath(directory);
if ((process.platform === "win32" ? realDirectory.toLowerCase() : realDirectory) !== (process.platform === "win32" ? directory.toLowerCase() : directory)) {
  throw new Error("Password hash directory may not traverse symbolic links or junctions.");
}
const existing = await fs.lstat(target).catch(() => null);
if (existing && !force) throw new Error("Password hash file already exists; use --force to rotate it.");
if (existing?.isSymbolicLink() || (existing && !existing.isFile())) throw new Error("Password hash target is unsafe.");

const password = await readPassword();
const record = await createPasswordRecord(password);
const temporary = path.join(directory, `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: "wx" });
try {
  if (existing && process.platform === "win32") {
    const backup = `${target}.${crypto.randomUUID()}.bak`;
    await fs.rename(target, backup);
    try {
      await fs.rename(temporary, target);
      await fs.unlink(backup);
    } catch (error) {
      await fs.rename(backup, target).catch(() => {});
      throw error;
    }
  } else {
    await fs.rename(temporary, target);
  }
  await fs.chmod(target, 0o600);
} finally {
  await fs.unlink(temporary).catch(() => {});
}
console.log(`Password hash written securely to ${target}`);
if (force) console.log("Password rotated. Restart the project-admin service to invalidate the cached hash and all existing sessions.");
