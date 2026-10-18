/**
 * Pure classification and deny-before-write CLI tests. Synthetic contexts only.
 * No parent environment changes, network, credentials, DBs or real archive data.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isReplitDevelopmentWorkspace } from "./catalog-archive/secure-fs.mjs";

const fixture = Object.freeze({
  REPL_ID: "11111111-2222-4333-8444-555555555555",
  REPLIT_DEV_DOMAIN: "synthetic.editor.replit.dev",
  REPLIT_DOMAINS: "synthetic.editor.replit.dev",
  NODE_ENV: "development",
  REPLIT_ENVIRONMENT: "development",
});
const allowed = [
  ["complete development workspace", {}],
  ["workspace with the observed descriptive production label", { REPLIT_ENVIRONMENT: "production" }],
  ["workspace Shell without NODE_ENV", { NODE_ENV: undefined, REPLIT_ENVIRONMENT: "production" }],
  ["workspace without the optional descriptive label", { REPLIT_ENVIRONMENT: undefined }],
  ["several canonical development hosts", { REPLIT_DOMAINS: "other.replit.dev, synthetic.editor.replit.dev" }],
];
for (const [name, changes] of allowed) test(`allows ${name}`, () => {
  const env = Object.freeze({ ...fixture, ...changes });
  assert.equal(isReplitDevelopmentWorkspace(env), true);
  assert.deepEqual(env, { ...fixture, ...changes });
});

const denied = [
  ["published deployment despite leaked editor markers", { REPLIT_DEPLOYMENT: "1" }],
  ["empty deployment marker", { REPLIT_DEPLOYMENT: "" }],
  ["zero deployment marker", { REPLIT_DEPLOYMENT: "0" }],
  ["false deployment marker", { REPLIT_DEPLOYMENT: "false" }],
  ["unrecognized deployment marker", { REPLIT_DEPLOYMENT: "unknown" }],
  ["production Node process despite editor markers", { NODE_ENV: "production" }],
  ["unrecognized Node environment", { NODE_ENV: "staging" }],
  ["test Node environment is not development authorization", { NODE_ENV: "test" }],
  ["empty Node environment", { NODE_ENV: "" }],
  ["whitespace Node environment", { NODE_ENV: "development " }],
  ["unrecognized descriptive environment", { REPLIT_ENVIRONMENT: "staging" }],
  ["empty descriptive environment", { REPLIT_ENVIRONMENT: "" }],
  ["missing project identity", { REPL_ID: undefined }],
  ["malformed project identity", { REPL_ID: "not-a-project-id" }],
  ["missing editor hostname", { REPLIT_DEV_DOMAIN: undefined }],
  ["empty editor hostname", { REPLIT_DEV_DOMAIN: "" }],
  ["missing bound host list", { REPLIT_DOMAINS: undefined }],
  ["empty bound host list", { REPLIT_DOMAINS: "" }],
  ["editor hostname not bound to this environment", { REPLIT_DOMAINS: "other.replit.dev" }],
  ["mixed deployment and development hosts", { REPLIT_DOMAINS: "synthetic.editor.replit.dev,synthetic.replit.app" }],
  ["unrecognized extra host", { REPLIT_DOMAINS: "synthetic.editor.replit.dev,example.com" }],
  ["empty extra host", { REPLIT_DOMAINS: "synthetic.editor.replit.dev," }],
  ["duplicate bound hosts", { REPLIT_DOMAINS: "synthetic.editor.replit.dev,synthetic.editor.replit.dev" }],
];
for (const [name, changes] of denied) test(`rejects ${name}`, () => {
  assert.equal(isReplitDevelopmentWorkspace(Object.freeze({ ...fixture, ...changes })), false);
});
for (const host of [
  "synthetic.replit.app", "replit.dev", "synthetic.replit.dev.evil.example",
  "https://synthetic.replit.dev", "synthetic.replit.dev:443",
  "synthetic.replit.dev/path", "user@synthetic.replit.dev",
  "synthetic.replit.dev?query", "synthetic.replit.dev#fragment",
  "synthetic..replit.dev", "_synthetic.replit.dev", "-synthetic.replit.dev",
  "synthetic-.replit.dev", " synthetic.replit.dev", "synthetic.replit.dev.",
  "Synthetic.replit.dev", `${"a".repeat(64)}.replit.dev`,
  `${Array(5).fill("a".repeat(63)).join(".")}.replit.dev`,
]) test(`rejects malformed/untrusted hostname ${host.length > 100 ? "(overlong)" : host}`, () => {
  assert.equal(isReplitDevelopmentWorkspace({ ...fixture, REPLIT_DEV_DOMAIN: host, REPLIT_DOMAINS: host }), false);
});
for (const env of [
  {}, { NODE_ENV: "development" }, { REPLIT_ENVIRONMENT: "production" },
  { NODE_ENV: "production", REPLIT_DEPLOYMENT: "1", REPLIT_ENVIRONMENT: "production" },
]) test(`rejects incomplete or production-only context ${JSON.stringify(env)}`, () => {
  assert.equal(isReplitDevelopmentWorkspace(Object.freeze(env)), false);
});

const tool = fileURLToPath(new URL("./catalog-archive/tool.mjs", import.meta.url));
for (const [name, context] of [
  ["published deployment", { ...fixture, REPLIT_DEPLOYMENT: "1" }],
  ["production Node process", { ...fixture, NODE_ENV: "production" }],
  ["missing workspace identity", {}],
  ["conflicting hostname binding", { ...fixture, REPLIT_DOMAINS: "other.replit.dev" }],
]) test(`CLI refuses ${name} before creating archive or keys`, async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "tsh-archive-guard-test-"));
  try {
    const workspace = path.join(base, "synthetic-workspace");
    await fs.mkdir(workspace, { mode: 0o700 });
    const archive = path.join(base, "must-not-create-archive");
    const keys = path.join(base, "must-not-create-keys");
    const result = spawnSync(process.execPath, [tool, "init-server",
      "--out", archive, "--key-root", keys, "--workspace", workspace],
    { env: { PATH: process.env.PATH, ...context }, encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ARCHIVE_DEVELOPMENT_ONLY/);
    assert.equal(result.stdout, "");
    await assert.rejects(fs.stat(archive), { code: "ENOENT" });
    await assert.rejects(fs.stat(keys), { code: "ENOENT" });
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});
