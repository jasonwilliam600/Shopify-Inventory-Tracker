/**
 * Real CLI/PTY tests with synthetic encrypted fixtures only.
 * No DB, network, Shopify, real catalog, archive activation or credential reads.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { seal, keyId, makeBackup } from "./catalog-archive/format.mjs";
import { sha256 } from "./catalog-archive/secure-fs.mjs";

const tool = fileURLToPath(new URL("./catalog-archive/tool.mjs", import.meta.url));
// New child-process fixture only; never alters the real process environment.
const cleanEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: os.tmpdir(), LANG: "C.UTF-8",
  NODE_ENV: "development", REPL_ID: "11111111-2222-4333-8444-555555555555",
  REPLIT_DEV_DOMAIN: "synthetic.editor.replit.dev", REPLIT_DOMAINS: "synthetic.editor.replit.dev" };
const password = "fictional PTY fixture passphrase only";
async function isolated(fn) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "tsh-portable-cli-test-"));
  try { await fn(base); } finally { await fs.rm(base, { recursive: true, force: true }); }
}
async function fixture(base) {
  const key = randomBytes(32), runId = randomUUID(), backupId = randomUUID();
  const source = Buffer.from('{"synthetic":true}\n');
  const manifest = Buffer.from(JSON.stringify({ kind: "tsh-initial-catalog-import-v1", runId, receipt: { downloadSha256: sha256(source) } }));
  const records = [["manifest", manifest], ["source", source], ["provenance", Buffer.from("SYNTHETIC ONLY")]]
    .map(([slot, bytes]) => ({ slot, encrypted: seal(bytes, key, { runId, slot, keyId: keyId(key) }).toString("base64") }));
  const bytes = await makeBackup({ kind: "tsh-private-backup-v1", runId, backupId, archiveKey: key.toString("base64"),
    challenge: randomBytes(32).toString("hex"), manifestSha256: sha256(manifest), records }, password);
  key.fill(0);
  const filename = path.join(base, "fixture.tshbackup");
  await fs.writeFile(filename, bytes, { mode: 0o600 });
  return { filename, hash: sha256(bytes), manifestHash: sha256(manifest), source };
}
test("standalone portable CLI restores in a separate PTY process without echoing the passphrase", async () => isolated(async base => {
  const f = await fixture(base), output = path.join(base, "independent-process-restore");
  const python = `
import sys,os,pty,subprocess,select,time,json
password=sys.stdin.buffer.read()
master,slave=pty.openpty()
p=subprocess.Popen(sys.argv[1:],stdin=slave,stdout=slave,stderr=slave,close_fds=True)
os.close(slave)
output=b'';sent=False;deadline=time.time()+30
while time.time()<deadline:
 ready,_,_=select.select([master],[],[],0.1)
 if ready:
  try: chunk=os.read(master,65536)
  except OSError: break
  if not chunk: break
  output+=chunk
  if b'Backup passphrase (hidden;' in output and not sent:
   os.write(master,password+b'\\n');sent=True
 if p.poll() is not None and not ready: break
if p.poll() is None:
 p.kill()
p.wait()
os.close(master)
print(json.dumps({'exitCode':p.returncode,'promptSeen':sent,'secretEchoed':password in output,'restoreSucceeded':b'PRIVATE_RESTORE_VERIFIED' in output}))
`;
  const result = spawnSync("python", ["-c", python, process.execPath, tool, "restore", "--backup", f.filename,
    "--backup-sha", f.hash, "--manifest-sha", f.manifestHash, "--out", output],
  { env: cleanEnv, input: password, encoding: "utf8", timeout: 40000, maxBuffer: 1048576 });
  assert.equal(result.status, 0);
  const summary = JSON.parse(result.stdout);
  assert.deepEqual(summary, { exitCode: 0, promptSeen: true, secretEchoed: false, restoreSucceeded: true });
  assert.deepEqual(await fs.readFile(path.join(output, "catalog-source.jsonl")), f.source);
  assert.equal(JSON.parse(await fs.readFile(path.join(output, "restore-receipt.json"), "utf8")).platform, process.platform);
}));
test("noninteractive verification fails closed instead of accepting a password from arguments", async () => isolated(async base => {
  const f = await fixture(base);
  const result = spawnSync(process.execPath, [tool, "verify", "--backup", f.filename, "--backup-sha", f.hash,
    "--manifest-sha", f.manifestHash], { env: cleanEnv, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /BACKUP_INTERACTIVE_TERMINAL_REQUIRED/);
  assert.equal(result.stdout, "");
}));
test("server initialization refuses a production process without creating archive/key directories", async () => isolated(async base => {
  const workspace = path.join(base, "workspace"); await fs.mkdir(workspace);
  const output = path.join(base, "forbidden-archive"), keys = path.join(base, "forbidden-keys");
  const result = spawnSync(process.execPath, [tool, "init-server", "--out", output, "--key-root", keys, "--workspace", workspace],
    { env: { ...cleanEnv, NODE_ENV: "production" }, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ARCHIVE_DEVELOPMENT_ONLY/);
  await assert.rejects(fs.stat(output), /ENOENT/);
  await assert.rejects(fs.stat(keys), /ENOENT/);
}));
