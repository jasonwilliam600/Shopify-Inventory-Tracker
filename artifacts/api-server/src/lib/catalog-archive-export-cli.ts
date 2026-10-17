/**
 * Explicit offline DEVELOPMENT export only, not mounted or invoked by the app.
 * Build to /tmp as documented. Never calls a database, Shopify or an importer.
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { CatalogFilesystemArchive } from "./catalog-filesystem-archive";
import { checkPrivateRoot, readPrivate, fail, within, requireDevelopmentRuntime } from "../../../../scripts/catalog-archive/secure-fs.mjs";
import { passphrasePrompt } from "../../../../scripts/catalog-archive/tool.mjs";
import type { RestoreReceipt } from "../../../../scripts/catalog-archive/format.mjs";

async function main(): Promise<void> {
  requireDevelopmentRuntime();
  const { positionals, values: v } = parseArgs({ allowPositionals: true, strict: true, options: {
    root: { type: "string" }, workspace: { type: "string" }, "key-root": { type: "string" },
    run: { type: "string" }, receipt: { type: "string" }, backup: { type: "string" },
    "confirm-independent-restore": { type: "boolean", default: false },
  } });
  if (positionals.length !== 1 || !["export", "accept-receipt"].includes(positionals[0])) fail("ARCHIVE_COMMAND_INVALID");
  for (const key of ["root", "workspace", "key-root"] as const) {
    if (!v[key] || !path.isAbsolute(v[key]!) || path.resolve(v[key]!) !== v[key]) fail("ARCHIVE_ABSOLUTE_PATH_REQUIRED");
  }
  const root = v.root!, workspace = v.workspace!, keys = v["key-root"]!;
  if (within(root, keys) || within(keys, root)) fail("RECOVERY_KEY_SEPARATION_REQUIRED");
  await checkPrivateRoot(keys, [workspace, root]);
  const key = await readPrivate(keys, "archive.key");
  let archive: CatalogFilesystemArchive | undefined;
  try {
    archive = await CatalogFilesystemArchive.open({
      environment: "development", root, workspaceRoot: workspace, forbiddenRoots: [], key,
    });
    if (positionals[0] === "export") {
      if (!v.run) fail("ARCHIVE_RUN_REQUIRED");
      const first = await passphrasePrompt();
      process.stderr.write("Confirm the same backup passphrase.\n");
      if (first !== await passphrasePrompt()) fail("BACKUP_PASSPHRASES_DIFFER");
      console.log(JSON.stringify(await archive.exportEncryptedBackup(v.run, first), null, 2));
    } else {
      if (v["confirm-independent-restore"] !== true || !v.receipt || !v.backup
        || !path.isAbsolute(v.receipt) || path.resolve(v.receipt) !== v.receipt
        || path.dirname(v.receipt) !== root) fail("BACKUP_OPERATOR_CONFIRMATION_REQUIRED");
      const receipt = JSON.parse((await readPrivate(root, path.basename(v.receipt))).toString("utf8")) as RestoreReceipt;
      await archive.acceptIndependentRestore({ receipt, backupFilename: v.backup, confirmedIndependentRestore: true });
      console.log(JSON.stringify({ status: "INDEPENDENT_RESTORE_ACKNOWLEDGED", runId: receipt.runId, importsExecuted: false }));
    }
  } finally { key.fill(0); archive?.destroy(); }
}
// This dedicated file is a CLI entrypoint, never imported by application code.
main().catch(e => {
  const code = /^[A-Z][A-Z0-9_]{2,100}$/.test(e?.message ?? "") ? e.message
    : /^[A-Z][A-Z0-9_]{2,100}$/.test(e?.code ?? "") ? e.code : "ARCHIVE_OPERATION_FAILED";
  console.error(code); process.exitCode = 1;
});
