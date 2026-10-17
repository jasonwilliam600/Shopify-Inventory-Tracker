import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import { CatalogFilesystemArchive } from "./catalog-filesystem-archive";
import { prepareInitialCatalogImport, initialCatalogManifest } from "./shopify-catalog-importer";
import { parseBulkCatalog } from "./shopify-bulk-catalog";
import type { BulkCatalogEvidence } from "./shopify-bulk-catalog-contract";
import { inspectBackup, signRestoreReceipt } from "../../../../scripts/catalog-archive/format.mjs";
import { sha256, readPrivate, writeImmutable } from "../../../../scripts/catalog-archive/secure-fs.mjs";
import { restoreVerifiedBackup, recoverEncryptedArchive, main } from "../../../../scripts/catalog-archive/tool.mjs";

// Synthetic fixtures ONLY. No real catalog, credentials, DB clients or HTTP.
const passphrase = "fictional offline test passphrase only";
async function isolated(fn: (base: string) => Promise<void>) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "tsh-filesystem-archive-test-"));
  try { await fn(base); } finally { await fs.rm(base, { recursive: true, force: true }); }
}
async function fixture(base: string, count = 3, padding = "") {
  const workspaceRoot = path.join(base, "workspace"), served = path.join(base, "served");
  await fs.mkdir(workspaceRoot, { mode: 0o700 }); await fs.mkdir(path.join(workspaceRoot, ".git"));
  await fs.mkdir(served, { mode: 0o700 });
  const source = Buffer.from(Array.from({ length: count }, (_, i) => JSON.stringify({
    id: `gid://shopify/ProductVariant/${i + 1}`, sku: i === 0 ? "" : i === 1 ? "TEST-SKU" : i === 2 ? "test-sku" : `TEST-${i}`,
    title: "Synthetic variant", selectedOptions: [{ name: "Colour", value: "Blue ®" }],
    inventoryItem: { id: `gid://shopify/InventoryItem/${i + 1}` },
    product: { id: `gid://shopify/Product/${i + 1}`, title: `Synthetic only ${padding}`, vendor: "Fixture",
      status: ["ACTIVE", "DRAFT", "ARCHIVED"][i % 3] },
  })).join("\n") + "\n");
  const now = Date.now(), chunks = { async *[Symbol.asyncIterator]() {
    for (let offset = 0; offset < source.length; offset += 65536) yield source.subarray(offset, offset + 65536);
  } };
  const evidence: BulkCatalogEvidence = {
    source: "live_shopify", retrievalMode: "bulk", apiVersion: "2026-07", layout: "variant_roots",
    shopDomain: "fixture.myshopify.com", scopes: ["read_products"], expectedVariantCount: count,
    operation: { id: "gid://shopify/BulkOperation/1", type: "QUERY", status: "COMPLETED", errorCode: null,
      createdAt: new Date(now - 120000).toISOString(), completedAt: new Date(now - 115000).toISOString(),
      querySha256: "a".repeat(64), objectCount: count, rootObjectCount: count, fileSizeBytes: source.length },
    download: { source: "shopify_bulk_query_result", resultKind: "complete",
      operationId: "gid://shopify/BulkOperation/1", shopDomain: "fixture.myshopify.com", querySha256: "a".repeat(64),
      resultUrlSha256: "b".repeat(64), downloadedAt: new Date(now - 110000).toISOString(), transportComplete: true,
      expectedSha256: sha256(source) },
  };
  const policy = { nowMs: now, maxAgeMs: 3600000 }, parsed = await parseBulkCatalog(chunks, evidence, policy);
  evidence.reconciliation = { source: "independent_live_observation", observationReference: "gid://shopify/BulkOperation/2",
    shopDomain: evidence.shopDomain, querySha256: evidence.operation.querySha256, observedAt: new Date(now - 60000).toISOString(),
    variantCount: count, identityDigestSha256: parsed.receipt.identityDigestSha256 };
  const plan = await prepareInitialCatalogImport({ chunks, evidence, policy, runId: randomUUID(),
    expectedShopDomain: evidence.shopDomain, expectedVariantCount: count });
  const options = { environment: "development" as const, root: path.join(base, "archive"),
    workspaceRoot, forbiddenRoots: [served], key: randomBytes(32) };
  const archive = await CatalogFilesystemArchive.create(options), reference = `private-manifest:${plan.runId}`;
  await archive.archiveManifest(plan);
  await archive.archiveSource(plan.runId, source);
  await archive.archiveProvenance(plan.runId, Buffer.from("SYNTHETIC evidence only; not a real Shopify receipt.\n"));
  return { archive, options, plan, source, reference, served };
}
async function backup(f: Awaited<ReturnType<typeof fixture>>) {
  const exported = await f.archive.exportEncryptedBackup(f.plan.runId, passphrase);
  const bytes = await readPrivate(f.options.root, exported.filename);
  const payload = await inspectBackup(bytes, passphrase, exported.backupSha256, exported.manifestSha256);
  return { exported, bytes, payload };
}
test("manifest remains blocked until encrypted backup, full restore and owner confirmation", async () => isolated(async base => {
  const f = await fixture(base);
  await assert.rejects(f.archive.readManifest(f.reference), /INDEPENDENT_BACKUP_REQUIRED/);
  const b = await backup(f);
  await assert.rejects(f.archive.readManifest(f.reference), /INDEPENDENT_BACKUP_REQUIRED/);
  const receipt = await restoreVerifiedBackup(b.payload, path.join(base, "simulated-independent-restore"));
  await assert.rejects(Reflect.apply(f.archive.acceptIndependentRestore, f.archive,
    [{ receipt, backupFilename: b.exported.filename, confirmedIndependentRestore: false }]), /OPERATOR_CONFIRMATION_REQUIRED/);
  await f.archive.acceptIndependentRestore({ receipt, backupFilename: b.exported.filename, confirmedIndependentRestore: true });
  assert.deepEqual(await f.archive.readManifest(f.reference), initialCatalogManifest(f.plan));
  const recreated = await CatalogFilesystemArchive.open(f.options);
  assert.deepEqual(await recreated.readManifest(f.reference), initialCatalogManifest(f.plan));
  b.payload.archiveKey.fill(0);
}));
test("owner-only directories/files and encrypted-at-rest content", async () => isolated(async base => {
  const f = await fixture(base);
  assert.equal((await fs.stat(f.options.root)).mode & 0o777, 0o700);
  for (const name of await fs.readdir(f.options.root)) {
    assert.equal((await fs.stat(path.join(f.options.root, name))).mode & 0o777, 0o600);
    const text = await fs.readFile(path.join(f.options.root, name), "utf8");
    assert.equal(text.includes("Synthetic variant"), false);
    assert.equal(text.includes("SYNTHETIC evidence"), false);
  }
  await fs.chmod(f.options.root, 0o755);
  await assert.rejects(f.archive.readManifest(f.reference), /PRIVATE_DIRECTORY_REQUIRED/);
}));
test("files with public permissions, hardlinks, symlinks and invalid file types are refused", async () => isolated(async base => {
  const f = await fixture(base), filename = path.join(f.options.root, `${f.plan.runId}.manifest.enc`);
  await fs.chmod(filename, 0o644);
  await assert.rejects(f.archive.readManifest(f.reference), /PRIVATE_FILE_REQUIRED/);
  await fs.chmod(filename, 0o600);
  const linked = path.join(base, "hardlink");
  await fs.link(filename, linked);
  await assert.rejects(f.archive.readManifest(f.reference), /PRIVATE_FILE_REQUIRED/);
  await fs.unlink(linked); await fs.rename(filename, linked);
  await fs.symlink(linked, filename);
  await assert.rejects(f.archive.readManifest(f.reference), /ELOOP/);
  await fs.unlink(filename); await fs.mkdir(filename);
  await assert.rejects(f.archive.readManifest(f.reference), /PRIVATE_FILE_REQUIRED/);
}));
test("roots inside Git, workspace, served trees and symlinked ancestors are refused", async () => isolated(async base => {
  const f = await fixture(base);
  await assert.rejects(CatalogFilesystemArchive.create({ ...f.options, root: path.join(f.options.workspaceRoot, "vault") }), /INSIDE_GIT|FORBIDDEN_ROOT/);
  await assert.rejects(CatalogFilesystemArchive.create({ ...f.options, root: path.join(f.served, "vault") }), /FORBIDDEN_ROOT/);
  const link = path.join(base, "ancestor-link");
  await fs.symlink(f.options.root, link);
  await assert.rejects(CatalogFilesystemArchive.open({ ...f.options, root: link }), /UNSAFE_ANCESTOR/);
  await assert.rejects(f.archive.readManifest("private-manifest:../../secret"), /INVALID_REFERENCE/);
}));
test("wrong key, ciphertext corruption and copied-record identity mismatches fail closed", async () => isolated(async base => {
  const f = await fixture(base), file = path.join(f.options.root, `${f.plan.runId}.manifest.enc`);
  const wrong = await CatalogFilesystemArchive.open({ ...f.options, key: randomBytes(32) });
  await assert.rejects(wrong.readManifest(f.reference), /CONTEXT_MISMATCH/);
  const json = JSON.parse(await fs.readFile(file, "utf8"));
  json.ciphertext = (json.ciphertext[0] === "A" ? "B" : "A") + json.ciphertext.slice(1);
  await fs.writeFile(file, JSON.stringify(json), { mode: 0o600 });
  await assert.rejects(f.archive.readManifest(f.reference), /DECRYPTION_FAILED/);
}));
test("same-content retries are idempotent; conflicts and concurrent overwrites cannot replace data", async () => isolated(async base => {
  const f = await fixture(base), filename = path.join(f.options.root, `${f.plan.runId}.source.enc`);
  const original = sha256(await fs.readFile(filename));
  await f.archive.archiveSource(f.plan.runId, f.source);
  assert.equal(sha256(await fs.readFile(filename)), original);
  await assert.rejects(f.archive.archiveSource(f.plan.runId, Buffer.from("different")), /IMMUTABILITY_CONFLICT/);
  const run = randomUUID();
  const results = await Promise.allSettled([
    f.archive.archiveProvenance(run, Buffer.from("one immutable value")),
    f.archive.archiveProvenance(run, Buffer.from("other immutable value")),
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(sha256(await fs.readFile(filename)), original);
}));
test("missing/changed source, short passphrase and forged plans cannot produce a usable backup", async () => isolated(async base => {
  const f = await fixture(base);
  await assert.rejects(f.archive.archiveManifest({ ...f.plan }), /UNVALIDATED_IMPORT_PLAN/);
  await assert.rejects(f.archive.exportEncryptedBackup(f.plan.runId, "short"), /PASSPHRASE_LENGTH/);
  await fs.unlink(path.join(f.options.root, `${f.plan.runId}.source.enc`));
  await assert.rejects(f.archive.exportEncryptedBackup(f.plan.runId, passphrase), /ENOENT/);
  await f.archive.archiveSource(f.plan.runId, Buffer.from("wrong source"));
  await assert.rejects(f.archive.exportEncryptedBackup(f.plan.runId, passphrase), /SOURCE_MISMATCH/);
}));
test("wrong backup hashes, wrong passwords, tampering and unsafe KDF settings are rejected", async () => isolated(async base => {
  const f = await fixture(base), b = await backup(f);
  await assert.rejects(inspectBackup(b.bytes, passphrase, "f".repeat(64), b.exported.manifestSha256), /BACKUP_HASH_MISMATCH/);
  await assert.rejects(inspectBackup(b.bytes, "different fictional passphrase", b.exported.backupSha256, b.exported.manifestSha256), /BACKUP_DECRYPTION_FAILED/);
  const changed = Buffer.from(b.bytes); changed[10] ^= 1;
  await assert.rejects(inspectBackup(changed, passphrase, b.exported.backupSha256, b.exported.manifestSha256), /BACKUP_HASH_MISMATCH/);
  const json = JSON.parse(b.bytes.toString()); json.kdf.N *= 2;
  const malicious = Buffer.from(JSON.stringify(json));
  await assert.rejects(inspectBackup(malicious, passphrase, sha256(malicious), b.exported.manifestSha256), /BACKUP_KDF_INVALID/);
  b.payload.archiveKey.fill(0);
}));
test("forged or replayed restore receipts and a lost/changed backup remain blocked", async () => isolated(async base => {
  const f = await fixture(base), b = await backup(f);
  const receipt = signRestoreReceipt(b.payload, "linux"); // explicitly synthetic receipt, not proof of another host
  await assert.rejects(f.archive.acceptIndependentRestore({ receipt: { ...receipt, mac: "0".repeat(64) },
    backupFilename: b.exported.filename, confirmedIndependentRestore: true }), /RECEIPT_INVALID/);
  await assert.rejects(f.archive.acceptIndependentRestore({ receipt: { ...receipt, backupId: randomUUID() },
    backupFilename: b.exported.filename, confirmedIndependentRestore: true }), /RECEIPT_INVALID/);
  await f.archive.acceptIndependentRestore({ receipt, backupFilename: b.exported.filename, confirmedIndependentRestore: true });
  await fs.writeFile(path.join(f.options.root, b.exported.filename), Buffer.from("corrupted backup"));
  await assert.rejects(f.archive.readManifest(f.reference), /BACKUP_HASH_MISMATCH/);
  b.payload.archiveKey.fill(0);
}));
test("independent restore reads every field and refuses existing destinations or partial-success receipts", async () => isolated(async base => {
  const f = await fixture(base), b = await backup(f), destination = path.join(base, "restore");
  const receipt = await restoreVerifiedBackup(b.payload, destination);
  assert.equal(sha256(await fs.readFile(path.join(destination, "manifest.json"))), f.plan.manifestSha256);
  assert.deepEqual(await fs.readFile(path.join(destination, "catalog-source.jsonl")), f.source);
  assert.equal(receipt.objectCount, 3);
  await assert.rejects(restoreVerifiedBackup(b.payload, destination), /EEXIST/);
  assert.equal((await fs.stat(destination)).mode & 0o777, 0o700);
  const parsed = JSON.parse((await fs.readFile(path.join(destination, "manifest.json"))).toString());
  assert.equal(parsed.variants[0].skuStatus, "missing");
  assert.equal(parsed.variants[1].skuStatus, "duplicate");
  assert.equal(parsed.variants[2].sku, "test-sku");
  assert.equal(parsed.variants[2].productStatus, "ARCHIVED");
  b.payload.archiveKey.fill(0);
}));
test("workspace-loss recovery restores encrypted objects/key but never automatically clears the backup gate", async () => isolated(async base => {
  const f = await fixture(base), b = await backup(f);
  const receipt = await restoreVerifiedBackup(b.payload, path.join(base, "offline-restore"));
  const recovered = path.join(base, "recovered"), keys = path.join(base, "recovered-keys");
  await recoverEncryptedArchive(b.payload, b.bytes, recovered, keys, f.options.workspaceRoot);
  const replacement = await CatalogFilesystemArchive.open({ ...f.options, root: recovered, key: await readPrivate(keys, "archive.key") });
  await assert.rejects(replacement.readManifest(f.reference), /INDEPENDENT_BACKUP_REQUIRED/);
  await replacement.acceptIndependentRestore({ receipt, backupFilename: b.exported.filename, confirmedIndependentRestore: true });
  assert.deepEqual(await replacement.readManifest(f.reference), initialCatalogManifest(f.plan));
  b.payload.archiveKey.fill(0);
}));
test("an interrupted restore leaves no success receipt and cannot overwrite its partial destination", async () => isolated(async base => {
  const f = await fixture(base), b = await backup(f), destination = path.join(base, "interrupted");
  // Fault injection AFTER validation: simulate a later write colliding/failing.
  b.payload.records.push(b.payload.records[0]);
  await assert.rejects(restoreVerifiedBackup(b.payload, destination), /EEXIST/);
  await assert.rejects(fs.stat(path.join(destination, "restore-receipt.json")), /ENOENT/);
  await assert.rejects(restoreVerifiedBackup(b.payload, destination), /EEXIST/);
  await assert.rejects(f.archive.readManifest(f.reference), /INDEPENDENT_BACKUP_REQUIRED/);
  b.payload.archiveKey.fill(0);
}));
test("root replacement, destroyed keys, pending crash files and production use cannot silently pass", async () => isolated(async base => {
  const f = await fixture(base);
  await writeImmutable(f.options.root, `pending-${randomUUID()}.enc`, randomBytes(100));
  await assert.rejects(f.archive.readManifest(f.reference), /INDEPENDENT_BACKUP_REQUIRED/);
  await assert.rejects(CatalogFilesystemArchive.open({ ...f.options, environment: "production" as "development" }), /DEVELOPMENT_ONLY/);
  f.archive.destroy();
  await assert.rejects(f.archive.readManifest(f.reference), /KEY_DESTROYED/);
  const reopened = await CatalogFilesystemArchive.open(f.options);
  await fs.rename(f.options.root, path.join(base, "old-root")); await fs.mkdir(f.options.root, { mode: 0o700 });
  await assert.rejects(reopened.readManifest(f.reference), /ROOT_REPLACED/);
}));
test("CLI initializes only empty private roots, never prints a key or accepts secret arguments", async () => isolated(async base => {
  const workspace = path.join(base, "workspace"); await fs.mkdir(workspace, { mode: 0o700 });
  const output = path.join(base, "empty-archive"), keys = path.join(base, "empty-keys");
  const result = await main(["init-server", "--out", output, "--key-root", keys, "--workspace", workspace]);
  assert.equal(result.enablesImports, false);
  assert.equal((await fs.readFile(path.join(keys, "archive.key"))).length, 32);
  assert.equal((await fs.stat(path.join(keys, "archive.key"))).mode & 0o777, 0o600);
  await assert.rejects(main(["verify", "--passphrase", "NEVER_A_SECRET_ARG"]), /Unknown option/);
}));
test("catalog-sized synthetic archive survives encryption, backup, cold restore and receipt verification", async () => isolated(async base => {
  const f = await fixture(base, 512, "X".repeat(33000)); // >16 MiB; never the actual catalog
  assert.ok(f.source.length > 16 * 1024 * 1024);
  const b = await backup(f), receipt = await restoreVerifiedBackup(b.payload, path.join(base, "large-restore"));
  await f.archive.acceptIndependentRestore({ receipt, backupFilename: b.exported.filename, confirmedIndependentRestore: true });
  assert.equal(sha256(await f.archive.readManifest(f.reference)), f.plan.manifestSha256);
  b.payload.archiveKey.fill(0);
}));
