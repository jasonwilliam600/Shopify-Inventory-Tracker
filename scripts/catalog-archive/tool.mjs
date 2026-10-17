#!/usr/bin/env node
/**
 * Standalone offline storage utility; built-in Node modules only.
 * No HTTP server, SDK, database, Shopify, imports, key printing or secret argv.
 */
import * as fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { checkPrivateRoot, createPrivateRoot, createRestoreDirectory, writeRestoreFile,
  readPortableInput, writeImmutable, sha256, within, fail, requireDevelopmentRuntime } from "./secure-fs.mjs";
import { inspectBackup, signRestoreReceipt, seal, keyId } from "./format.mjs";

export async function restoreVerifiedBackup(payload, output) {
  await createRestoreDirectory(output);
  // A receipt is emitted only after every object is decrypted and durably
  // written/read back in a fresh private directory. Existing targets fail.
  for (const record of payload.records) {
    const name = record.slot === "manifest" ? "manifest.json"
      : record.slot === "source" ? "catalog-source.jsonl"
      : record.slot === "provenance" ? "provenance.txt" : `${record.slot}.json`;
    await writeRestoreFile(output, name, record.plain);
  }
  const receipt = signRestoreReceipt(payload, process.platform);
  await writeRestoreFile(output, "restore-receipt.json", Buffer.from(JSON.stringify(receipt) + "\n"));
  return receipt;
}
export async function recoverEncryptedArchive(payload, backupBytes, output, keyRoot, workspace) {
  requireDevelopmentRuntime();
  if (process.platform === "win32") fail("ARCHIVE_SERVER_REQUIRES_POSIX");
  if (within(output, keyRoot) || within(keyRoot, output)) fail("RECOVERY_KEY_SEPARATION_REQUIRED");
  await createPrivateRoot(output, [workspace]);
  await createPrivateRoot(keyRoot, [workspace, output]);
  for (const record of payload.records) {
    await writeImmutable(output, `${payload.runId}.${record.slot}.enc`, record.encrypted);
  }
  await writeImmutable(output, `${payload.runId}.backup-${payload.backupId}.tshbackup`, backupBytes);
  await writeImmutable(output, `${payload.runId}.export-${payload.backupId}.enc`,
    seal(Buffer.from(JSON.stringify({
      kind: "tsh-backup-binding-v1", challenge: payload.challenge, backupSha256: payload.backupSha256,
      manifestSha256: payload.manifestSha256,
      records: payload.records.map(r => ({ slot: r.slot, sha256: sha256(r.encrypted) })),
    })), payload.archiveKey, { runId: payload.runId, slot: `export-${payload.backupId}`, keyId: keyId(payload.archiveKey) }));
  await writeImmutable(keyRoot, "archive.key", payload.archiveKey);
  // Deliberately no accepted-restore marker. The owner must re-confirm the
  // independent receipt; recovery never silently re-enables readManifest().
}
export async function passphrasePrompt() {
  if (!process.stdin.isTTY || !process.stderr.isTTY) fail("BACKUP_INTERACTIVE_TERMINAL_REQUIRED");
  const silent = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const rl = createInterface({ input: process.stdin, output: silent, terminal: true, historySize: 0 });
  // Disable terminal echo BEFORE displaying the prompt (including fast paste).
  process.stderr.write("Backup passphrase (hidden; never a command argument): ");
  try {
    return await new Promise((resolve, reject) => {
      let answered = false;
      rl.once("SIGINT", () => reject(new Error("BACKUP_CANCELLED")));
      rl.once("close", () => { if (!answered) reject(new Error("BACKUP_INPUT_CLOSED")); });
      rl.question("", value => { answered = true; resolve(value); });
    });
  } finally { rl.close(); process.stderr.write("\n"); }
}
export async function main(args = process.argv.slice(2)) {
  const parsed = parseArgs({ args, allowPositionals: true, strict: true, options: {
    backup: { type: "string" }, "backup-sha": { type: "string" }, "manifest-sha": { type: "string" },
    out: { type: "string" }, "key-root": { type: "string" }, workspace: { type: "string" },
  } });
  const [command, ...extra] = parsed.positionals, v = parsed.values;
  if (extra.length || !["prepare-download-dir", "init-server", "verify", "restore", "recover"].includes(command)) fail("BACKUP_COMMAND_INVALID");
  const absolute = key => {
    if (!v[key] || !path.isAbsolute(v[key]) || path.resolve(v[key]) !== v[key]) fail("BACKUP_ABSOLUTE_PATH_REQUIRED");
    return v[key];
  };
  if (command === "prepare-download-dir") {
    await createRestoreDirectory(absolute("out"));
    return { status: "PRIVATE_DOWNLOAD_DIRECTORY_READY", path: v.out };
  }
  if (command === "init-server") {
    requireDevelopmentRuntime();
    const output = absolute("out"), keys = absolute("key-root"), workspace = absolute("workspace");
    if (within(output, keys) || within(keys, output)) fail("RECOVERY_KEY_SEPARATION_REQUIRED");
    await createPrivateRoot(output, [workspace]);
    await createPrivateRoot(keys, [workspace, output]);
    const key = randomBytes(32);
    try { await writeImmutable(keys, "archive.key", key); }
    finally { key.fill(0); }
    return { status: "EMPTY_PRIVATE_ARCHIVE_INITIALIZED", root: output, keyFile: path.join(keys, "archive.key"),
      enablesImports: false };
  }
  const bytes = await readPortableInput(absolute("backup"));
  const payload = await inspectBackup(bytes, await passphrasePrompt(), v["backup-sha"], v["manifest-sha"]);
  try {
    if (command === "restore") {
      const receipt = await restoreVerifiedBackup(payload, absolute("out"));
      return { status: "PRIVATE_RESTORE_VERIFIED", runId: payload.runId,
        backupSha256: payload.backupSha256, manifestSha256: payload.manifestSha256,
        receipt: path.join(v.out, "restore-receipt.json"), platform: receipt.platform, enablesImports: false };
    }
    if (command === "recover") {
      await recoverEncryptedArchive(payload, bytes, absolute("out"), absolute("key-root"), absolute("workspace"));
      return { status: "ENCRYPTED_ARCHIVE_RECOVERED_AWAITING_INDEPENDENT_CONFIRMATION", root: v.out, enablesImports: false };
    }
    return { status: "BACKUP_DECRYPTION_VERIFIED", runId: payload.runId, objectCount: payload.records.length,
      backupSha256: payload.backupSha256, manifestSha256: payload.manifestSha256,
      independentRestoreReceiptCreated: false, enablesImports: false };
  } finally {
    payload.archiveKey.fill(0);
    for (const record of payload.records) record.plain.fill(0);
  }
}
if (process.argv[1] && path.basename(process.argv[1]) === "tool.mjs"
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(result => console.log(JSON.stringify(result, null, 2))).catch(e => {
    const code = /^[A-Z][A-Z0-9_]{2,100}$/.test(e?.message ?? "") ? e.message
      : /^[A-Z][A-Z0-9_]{2,100}$/.test(e?.code ?? "") ? e.code : "BACKUP_OPERATION_FAILED";
    console.error(code); process.exitCode = 1;
  });
}
