/** Disposable PostgreSQL + synthetic tests. Never inherits application credentials. */
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
const directory = await fs.mkdtemp("/tmp/tsh-matrixify-isolated-");
await fs.chmod(directory, 0o700);
const data = path.join(directory, "data"), socket = path.join(directory, "socket");
await fs.mkdir(socket, { mode: 0o700 });
const env = { PATH: process.env.PATH, HOME: directory, TMPDIR: directory, LANG: "C.UTF-8", LC_ALL: "C.UTF-8",
  NODE_ENV: "test", TSH_MATRIXIFY_TEST_SOCKET: socket };
function run(command, args) {
  const result = spawnSync(command, args, { env, stdio: "inherit", timeout: 150000 });
  if (result.error || result.status !== 0) throw new Error(`Isolated command failed: ${command} (${result.status})`);
}
let started = false;
try {
  const schema = await fs.readFile("reports/sku-mapping-final-schema-review/final-proposed-revised.sql");
  if (createHash("sha256").update(schema).digest("hex") !== "1cdd3b1500156e3abed021d322b42a05cb004cc7e3dc6c4287fb9b2567410fa0")
    throw new Error("Installed-schema fixture fingerprint changed; review before testing");
  run("initdb", ["-D", data, "-A", "trust", "--no-locale", "--encoding=UTF8", "-U", "tsh_matrixify_test"]);
  run("pg_ctl", ["-D", data, "-l", path.join(directory, "postgres.log"), "-o", `-h '' -k ${socket} -p 6544`, "-w", "start"]);
  started = true;
  const bundle = path.join(directory, "tests.mjs");
  run("pnpm", ["--filter", "@workspace/api-server", "exec", "esbuild", "src/lib/matrixify-workflow.test.ts",
    "--bundle", "--platform=node", "--format=esm", "--log-level=warning",
    "--banner:js=import { createRequire as __tshCreateRequire } from 'node:module'; const require = __tshCreateRequire(import.meta.url);",
    `--outfile=${bundle}`]);
  const regression = path.join(directory, "sync-regression.mjs");
  run("pnpm", ["--filter", "@workspace/api-server", "exec", "esbuild", "src/lib/synchronization.test.ts",
    "--bundle", "--platform=node", "--format=esm", "--log-level=warning",
    "--banner:js=import { createRequire as __tshCreateRequire } from 'node:module'; const require = __tshCreateRequire(import.meta.url);",
    `--outfile=${regression}`]);
  run("node", ["--import", "data:text/javascript,globalThis.fetch=()=>{throw new Error('NETWORK_FORBIDDEN_IN_ISOLATED_TESTS')}", "--test", bundle, regression]);
} finally {
  if (started) spawnSync("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { env, stdio: "inherit" });
  await fs.rm(directory, { recursive: true, force: true });
}
