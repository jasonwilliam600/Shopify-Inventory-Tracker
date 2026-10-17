/**
 * Isolated integration-test launcher. No app DB imports/URLs; Unix socket only.
 * Run from repository root: node scripts/test-shopify-catalog-importer.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-catalog-import-review."));
const socket = path.join(temp, "socket");
fs.mkdirSync(socket, { mode: 0o700 });
fs.chmodSync(temp, 0o700);
const env = { PATH: process.env.PATH, HOME: temp, TMPDIR: temp, LANG: "C", LC_ALL: "C" };
const run = (name, args, opts = {}) => execFileSync(name, args, { env, cwd: root, encoding: "utf8", stdio: "pipe", ...opts });
const binary = name => run("which", [name]).trim();
const initdb = binary("initdb"), pgctl = binary("pg_ctl"), psql = binary("psql");
let started = false;
try {
  run(initdb, ["-D", path.join(temp, "data"), "-A", "trust", "--no-locale", "--encoding=UTF8", "-U", "tsh_catalog_review"]);
  run(pgctl, ["-D", path.join(temp, "data"), "-l", path.join(temp, "postgres.log"),
    "-o", `-h '' -k ${socket} -p 55447`, "-w", "start"]);
  started = true;
  run(psql, ["-X", "-h", socket, "-p", "55447", "-U", "tsh_catalog_review", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-c", "CREATE DATABASE tsh_catalog_review"]);
  const esbuild = path.resolve("artifacts/api-server/node_modules/esbuild/bin/esbuild");
  run(esbuild, ["artifacts/api-server/src/lib/shopify-catalog-importer.ts",
    "--bundle", "--platform=node", "--format=esm", `--outfile=${temp}/importer.mjs`, "--log-level=warning"]);
  run(process.execPath, ["scripts/test-shopify-catalog-importer-cases.mjs", socket, path.join(temp, "importer.mjs")],
    { stdio: "inherit" });
  console.log(`Isolated test artifacts: ${temp}`);
} finally {
  if (started) run(pgctl, ["-D", path.join(temp, "data"), "-m", "fast", "-w", "stop"]);
}
