import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { CatalogPrivateArchive, type PrivateArchiveBucket } from "./catalog-private-archive";
import { reconcileIndependentBulkSnapshots } from "./catalog-bulk-reconciliation";
import { parseBulkCatalog } from "./shopify-bulk-catalog";
import { prepareInitialCatalogImport, initialCatalogManifest } from "./shopify-catalog-importer";
import type { BulkCatalogEvidence, BulkValidationPolicy } from "./shopify-bulk-catalog-contract";

const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
/** File-backed isolated SDK fake: no cloud calls, keys, app files or DB access. */
function fakeBucket(directory: string, settings: {
  public?: boolean; legacyAcl?: boolean; loseAcknowledgement?: boolean;
} = {}): PrivateArchiveBucket {
  return {
    name: "isolated-private-bucket",
    async getMetadata() { return [{ iamConfiguration: {
      uniformBucketLevelAccess: { enabled: !settings.legacyAcl },
      publicAccessPrevention: settings.public ? "inherited" : "enforced",
    } }]; },
    file(key, pinned) {
      const filename = join(directory, hash(key) + ".json");
      const stored = async () => JSON.parse(await readFile(filename, "utf8"));
      return {
        async save(bytes, options) {
          assert.equal(options.preconditionOpts.ifGenerationMatch, 0);
          assert.equal(options.validation, "crc32c");
          assert.equal(options.metadata.cacheControl, "no-store");
          const staging = filename + "." + randomUUID();
          try {
            await writeFile(staging, JSON.stringify({ generation: "1", size: bytes.length,
              metadata: options.metadata.metadata, base64: bytes.toString("base64") }), { flag: "wx", mode: 0o600 });
            await link(staging, filename); // atomically expose a complete object
          } catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") throw Object.assign(new Error("exists"), { code: 412 }); throw e; }
          finally { await rm(staging, { force: true }); }
          if (settings.loseAcknowledgement) throw new Error("isolated lost acknowledgement");
        },
        async getMetadata() { return [await stored()]; },
        async download(options) {
          assert.equal(options.validation, "crc32c");
          const saved = await stored();
          assert.equal(pinned?.generation, saved.generation);
          return [Buffer.from(saved.base64, "base64")];
        },
      };
    },
  };
}
async function isolated(fn: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "tsh-private-archive-test-"));
  try { await fn(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
const now = Date.now(), policy: BulkValidationPolicy = { nowMs: now, maxAgeMs: 3600000 };
function source(operationId = 1, sku = "Original-SKU") {
  const raw = Buffer.from(JSON.stringify({
    id: "gid://shopify/ProductVariant/1", sku, title: "Default", selectedOptions: [{ name: "Title", value: "Default" }],
    inventoryItem: { id: "gid://shopify/InventoryItem/1" },
    product: { id: "gid://shopify/Product/1", title: "Fixture", vendor: "Example", status: "DRAFT" },
  }) + "\n");
  const offset = operationId === 1 ? 360000 : 180000;
  const evidence: BulkCatalogEvidence = {
    source: "live_shopify", retrievalMode: "bulk", apiVersion: "2026-07", layout: "variant_roots",
    shopDomain: "fixture.myshopify.com", scopes: ["read_products"], expectedVariantCount: 1,
    operation: { id: `gid://shopify/BulkOperation/${operationId}`, type: "QUERY", status: "COMPLETED", errorCode: null,
      createdAt: new Date(now - offset).toISOString(), completedAt: new Date(now - offset + 30000).toISOString(),
      querySha256: "a".repeat(64), objectCount: 1, rootObjectCount: 1, fileSizeBytes: raw.length },
    download: { source: "shopify_bulk_query_result", resultKind: "complete",
      operationId: `gid://shopify/BulkOperation/${operationId}`, shopDomain: "fixture.myshopify.com",
      querySha256: "a".repeat(64), resultUrlSha256: "b".repeat(64),
      downloadedAt: new Date(now - offset + 60000).toISOString(), transportComplete: true,
      expectedSha256: hash(raw) },
  };
  return { evidence, chunks: { async *[Symbol.asyncIterator]() { yield raw; } } };
}
async function snapshot(id = 1, sku?: string) {
  const input = source(id, sku);
  return parseBulkCatalog(input.chunks, input.evidence, policy);
}
async function plan() {
  const a = source(), comparison = reconcileIndependentBulkSnapshots(await snapshot(), await snapshot(2), policy);
  a.evidence.reconciliation = comparison.evidence;
  return prepareInitialCatalogImport({ ...a, policy, runId: randomUUID(),
    expectedShopDomain: a.evidence.shopDomain, expectedVariantCount: 1 });
}

test("archive survives adapter/backend recreation with exact manifest bytes", async () => isolated(async directory => {
  const p = await plan();
  const archive = new CatalogPrivateArchive(fakeBucket(directory), "isolated-private-bucket");
  const receipt = await archive.archiveManifest(p);
  assert.equal(receipt.sha256, p.manifestSha256);
  assert.equal(receipt.reference, `private-manifest:${p.runId}`);
  const recreated = new CatalogPrivateArchive(fakeBucket(directory), "isolated-private-bucket");
  assert.deepEqual(await recreated.readManifest(receipt.reference), initialCatalogManifest(p));
}));
test("private provenance archive preserves closed evidence verbatim without certification", async () => isolated(async directory => {
  const archive = new CatalogPrivateArchive(fakeBucket(directory), "isolated-private-bucket");
  const bytes = Buffer.from("Original evidence closed.\nError Code: \nLocal File Last Write: supplied timestamp\n");
  const receipt = await archive.archiveProvenance(randomUUID(), bytes);
  assert.deepEqual(await archive.readProvenance(receipt.reference), Uint8Array.from(bytes));
  assert.equal(receipt.sha256, hash(bytes));
}));
test("same-content retries are idempotent; different content cannot overwrite", async () => isolated(async directory => {
  const archive = new CatalogPrivateArchive(fakeBucket(directory), "isolated-private-bucket"), id = randomUUID();
  const [a, b] = await Promise.all([archive.archiveProvenance(id, Buffer.from("same")), archive.archiveProvenance(id, Buffer.from("same"))]);
  assert.deepEqual(a, b);
  await assert.rejects(archive.archiveProvenance(id, Buffer.from("different")), /IMMUTABILITY_CONFLICT/);
  assert.equal(Buffer.from(await archive.readProvenance(a.reference)).toString(), "same");
}));
test("lost write acknowledgement reconciles bytes without overwriting", async () => isolated(async directory => {
  const archive = new CatalogPrivateArchive(fakeBucket(directory, { loseAcknowledgement: true }), "isolated-private-bucket");
  const receipt = await archive.archiveProvenance(randomUUID(), Buffer.from("acknowledged by readback"));
  assert.equal(receipt.generation, "1");
}));
test("privacy settings, bucket identity and unsafe references fail closed", async () => isolated(async directory => {
  assert.throws(() => new CatalogPrivateArchive(fakeBucket(directory), "wrong-bucket"), /BUCKET_MISMATCH/);
  for (const settings of [{ public: true }, { legacyAcl: true }]) {
    const archive = new CatalogPrivateArchive(fakeBucket(directory, settings), "isolated-private-bucket");
    await assert.rejects(archive.archiveProvenance(randomUUID(), Buffer.from("private")), /PRIVATE_POLICY_REQUIRED/);
  }
  const archive = new CatalogPrivateArchive(fakeBucket(directory), "isolated-private-bucket");
  await assert.rejects(archive.readManifest("private-manifest:../../secret"), /INVALID_ARCHIVE_RUN_ID/);
  await assert.rejects(archive.readManifest("https://example.invalid/file"), /INVALID_ARCHIVE_REFERENCE/);
  await assert.rejects(archive.archiveProvenance(randomUUID(), new Uint8Array()), /SIZE_LIMIT/);
}));
test("archive readback detects tampering and pins the object generation", async () => isolated(async directory => {
  const archive = new CatalogPrivateArchive(fakeBucket(directory), "isolated-private-bucket"), id = randomUUID();
  const receipt = await archive.archiveProvenance(id, Buffer.from("protected"));
  const filename = join(directory, hash(`tsh-private/catalog-imports/v1/${id}/provenance.txt`) + ".json");
  const saved = JSON.parse(await readFile(filename, "utf8")); saved.base64 = Buffer.from("CORRUPTED").toString("base64");
  await writeFile(filename, JSON.stringify(saved));
  await assert.rejects(archive.readProvenance(receipt.reference), /CHECKSUM_MISMATCH/);
}));
test("outcomes are append-only, validated and contain only allowed fields", async () => isolated(async directory => {
  const archive = new CatalogPrivateArchive(fakeBucket(directory), "isolated-private-bucket");
  const event = { runId: randomUUID(), eventId: randomUUID(), state: "outcome_unknown" as const,
    occurredAt: new Date(now).toISOString(), manifestSha256: "c".repeat(64) };
  const first = await archive.appendOutcome(event);
  assert.deepEqual(await archive.appendOutcome(event), first);
  await assert.rejects(archive.appendOutcome({ ...event, state: "committed" }), /IMMUTABILITY_CONFLICT/);
}));
test("separate later observations produce a witness without authorizing import", async () => {
  const result = reconcileIndependentBulkSnapshots(await snapshot(), await snapshot(2), policy);
  assert.equal(result.authorizesImport, false);
  assert.equal(result.evidence.observationReference, "gid://shopify/BulkOperation/2");
});
test("same-operation copies and earlier observations are not independent", async () => {
  const a = await snapshot();
  assert.throws(() => reconcileIndependentBulkSnapshots(a, structuredClone(a), policy), /NOT_INDEPENDENT/);
  const b = await snapshot(2); b.evidence.operation.createdAt = a.evidence.operation.createdAt;
  assert.throws(() => reconcileIndependentBulkSnapshots(a, b, policy), /OBSERVATION_TOO_EARLY/);
});
test("same count with changed identity, SKU or status does not reconcile", async () => {
  const a = await snapshot();
  const different = await snapshot(2, "DIFFERENT-SKU");
  assert.throws(() => reconcileIndependentBulkSnapshots(a, different, policy), /IDENTITY_RECONCILIATION_MISMATCH/);
  const tampered = await snapshot(2); tampered.identities[0].productStatus = "ACTIVE";
  assert.throws(() => reconcileIndependentBulkSnapshots(a, tampered, policy), /INVALID_MANIFEST/);
});
test("source, query, stale evidence and incomplete provenance stay blocked", async () => {
  const a = await snapshot(), b = await snapshot(2);
  const wrongQuery = structuredClone(b);
  wrongQuery.evidence.operation.querySha256 = "d".repeat(64); wrongQuery.evidence.download.querySha256 = "d".repeat(64);
  assert.throws(() => reconcileIndependentBulkSnapshots(a, wrongQuery, policy), /SOURCE_MISMATCH/);
  const missing = structuredClone(b); missing.evidence.scopes = [];
  assert.throws(() => reconcileIndependentBulkSnapshots(a, missing, policy), /PRODUCT_SCOPE_UNVERIFIED/);
  assert.throws(() => reconcileIndependentBulkSnapshots(a, b, { ...policy, maxAgeMs: 1 }), /STALE_OR_INVALID_BULK_TIME/);
  const incomplete = structuredClone(b); incomplete.evidence.download.transportComplete = false as true;
  assert.throws(() => reconcileIndependentBulkSnapshots(a, incomplete, policy), /INVALID_DOWNLOAD_PROVENANCE/);
});
