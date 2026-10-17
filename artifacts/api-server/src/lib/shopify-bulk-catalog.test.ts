import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { catalogIdentityDigest } from "./catalog-reconciliation";
import type { BulkCatalogEvidence, BulkValidationPolicy } from "./shopify-catalog-contract";
import { parseBulkCatalog, prepareBulkCatalogRows } from "./shopify-bulk-catalog";

const policy: BulkValidationPolicy = { nowMs: Date.parse("2026-10-17T10:05:00Z"), maxAgeMs: 3600_000 };
function node(id: number, sku: string | null = `SKU-${id}`) {
  return { id: `gid://shopify/ProductVariant/${id}`, sku, title: "Default — 日本語", selectedOptions: [{ name: "Color", value: "Red" }],
    inventoryItem: { id: `gid://shopify/InventoryItem/${id}` },
    product: { id: "gid://shopify/Product/1", title: "Fixture", vendor: "Fixture vendor", status: "ACTIVE" } };
}
const line = (value: unknown) => JSON.stringify(value) + "\n";
function receipt(bytes: number, objects: number, variants = objects, roots = objects): BulkCatalogEvidence {
  return {
    source: "live_shopify", retrievalMode: "bulk", apiVersion: "2026-07", layout: "variant_roots",
    shopDomain: "fixture.myshopify.com", scopes: ["read_products"], expectedVariantCount: variants,
    operation: { id: "gid://shopify/BulkOperation/1", type: "QUERY", status: "COMPLETED", errorCode: null,
      createdAt: "2026-10-17T10:00:00Z", completedAt: "2026-10-17T10:02:00Z", querySha256: "a".repeat(64),
      rootObjectCount: roots, objectCount: objects, fileSizeBytes: bytes },
    download: { source: "shopify_bulk_query_result", resultKind: "complete", operationId: "gid://shopify/BulkOperation/1",
      shopDomain: "fixture.myshopify.com", querySha256: "a".repeat(64), resultUrlSha256: "b".repeat(64),
      downloadedAt: "2026-10-17T10:03:00Z", transportComplete: true },
  };
}
async function* chunks(raw: string | Buffer, size = 127): AsyncGenerator<Uint8Array> {
  const bytes = typeof raw === "string" ? Buffer.from(raw) : raw;
  for (let i = 0; i < bytes.length; i += size) yield bytes.subarray(i, i + size);
}
function fixture(values = [node(1), node(2)]) {
  const raw = values.map(line).join("");
  return { raw, evidence: receipt(Buffer.byteLength(raw), values.length) };
}
async function reconciledFixture() {
  const f = fixture();
  const preview = await parseBulkCatalog(chunks(f.raw), f.evidence, policy);
  f.evidence.reconciliation = { source: "independent_live_observation", observationReference: "separate-fixture-observation",
    shopDomain: f.evidence.shopDomain, querySha256: f.evidence.operation.querySha256, observedAt: "2026-10-17T10:04:00Z",
    variantCount: 2, identityDigestSha256: preview.receipt.identityDigestSha256 };
  return f;
}

test("streams 42501 generated variants without constructing the raw download", async () => {
  const count = 42501;
  const makeLine = (i: number) => line(node(i, i % 997 === 0 ? null : i % 100 === 0 ? " Duplicate " : i % 100 === 1 ? "duplicate" : `SKU-${i}`));
  const digest = createHash("sha256");
  let bytes = 0;
  for (let i = 1; i <= count; i++) { const value = makeLine(i); bytes += Buffer.byteLength(value); digest.update(value); }
  const evidence = receipt(bytes, count);
  evidence.download.expectedSha256 = digest.digest("hex");
  let yielded = 0;
  async function* generated() { for (let i = 1; i <= count; i++) { yielded++; yield Buffer.from(makeLine(i)); } }
  const result = await parseBulkCatalog(generated(), evidence, policy);
  assert.equal(yielded, count);
  assert.equal(result.identities.length, count);
  assert.equal(result.receipt.byteCount, bytes);
  assert.ok(result.identities.some(v => v.skuStatus === "missing"));
  assert.ok(result.identities.some(v => v.skuStatus === "duplicate" && v.sku === " Duplicate "));
  assert.ok(result.identities.every(v => v.relationshipVerified === false));
  assert.equal(result.activationEligible, false);
  assert.equal(result.reconciliationStatus, "required");
  assert.throws(() => prepareBulkCatalogRows(result, policy), /CATALOG_RECONCILIATION_REQUIRED/);
});
test("handles UTF-8 boundaries, CRLF and final line without newline", async () => {
  const raw = JSON.stringify(node(1)) + "\r\n" + JSON.stringify(node(2));
  const e = receipt(Buffer.byteLength(raw), 2);
  const result = await parseBulkCatalog(chunks(raw, 1), e, policy);
  assert.equal(result.identities[0].variantTitle, "Default — 日本語");
});
test("accepts ungrouped children before parents and validates __parentId", async () => {
  const v = node(1);
  const raw = line({ ...v, product: undefined, __parentId: v.product.id }) + line(v.product);
  const e = receipt(Buffer.byteLength(raw), 2, 1, 1); e.layout = "products_with_variants";
  const result = await parseBulkCatalog(chunks(raw), e, policy);
  assert.equal(result.identities[0].productId, v.product.id);
  assert.equal(result.identities[0].vendor, v.product.vendor);
});
test("rejects orphaned variants, duplicate products and conflicting parent IDs", async () => {
  const v = node(1);
  for (const rows of [
    [{ ...v, product: undefined, __parentId: v.product.id }],
    [v.product, v.product, { ...v, product: undefined, __parentId: v.product.id }],
    [v.product, { ...v, __parentId: "gid://shopify/Product/2" }],
  ]) {
    const raw = rows.map(line).join("");
    const e = receipt(Buffer.byteLength(raw), rows.length, 1, rows.filter(r => r.id.startsWith("gid://shopify/Product/")).length);
    e.layout = "products_with_variants";
    await assert.rejects(parseBulkCatalog(chunks(raw), e, policy), /ORPHAN_|DUPLICATE_PRODUCT|CONFLICTING_/);
  }
});
test("rejects duplicate variant IDs even when expected counts agree", async () => {
  const f = fixture([node(1), node(1)]);
  await assert.rejects(parseBulkCatalog(chunks(f.raw), f.evidence, policy), /DUPLICATE_VARIANT_ID/);
});
test("rejects malformed JSON, invalid UTF-8 and truncation at or inside a record", async () => {
  const f = fixture();
  await assert.rejects(parseBulkCatalog(chunks(f.raw.slice(0, -8)), f.evidence, policy), /MALFORMED_|COMPLETENESS/);
  await assert.rejects(parseBulkCatalog(chunks(line(node(1))), f.evidence, policy), /COMPLETENESS/);
  const bytes = Buffer.from([0xff, 0xfe, 0x0a]);
  await assert.rejects(parseBulkCatalog(chunks(bytes), receipt(bytes.length, 1), policy), /BULK_STREAM_FAILED/);
});
test("rejects failed/cancelled/running operations and partial download receipts before reading", async () => {
  for (const status of ["FAILED", "CANCELED", "RUNNING", "EXPIRED"]) {
    const f = fixture(); (f.evidence.operation as { status: string }).status = status;
    await assert.rejects(parseBulkCatalog(chunks(f.raw), f.evidence, policy), /BULK_OPERATION_NOT_COMPLETE/);
  }
  const f = fixture(); (f.evidence.download as { resultKind: string }).resultKind = "partial";
  await assert.rejects(parseBulkCatalog(chunks(f.raw), f.evidence, policy), /INVALID_DOWNLOAD_PROVENANCE/);
});
test("requires matching operation/shop/query/result provenance and product scopes", async () => {
  const mutations: ((e: BulkCatalogEvidence) => void)[] = [
    e => { e.download.operationId = "gid://shopify/BulkOperation/2"; },
    e => { e.download.shopDomain = "other.myshopify.com"; },
    e => { e.download.querySha256 = "c".repeat(64); },
    e => { e.download.resultUrlSha256 = ""; },
    e => { e.scopes = ["read_inventory"]; },
    e => { (e as { source: string }).source = "historical"; },
    e => { (e.download as { transportComplete: boolean }).transportComplete = false; },
  ];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f.evidence);
    await assert.rejects(parseBulkCatalog(chunks(f.raw), f.evidence, policy));
  }
});
test("all expected byte/object/root/variant counts and download digest must match", async () => {
  for (const mutate of [
    (e: BulkCatalogEvidence) => { e.operation.fileSizeBytes++; },
    (e: BulkCatalogEvidence) => { e.operation.objectCount++; },
    (e: BulkCatalogEvidence) => { e.operation.rootObjectCount--; },
    (e: BulkCatalogEvidence) => { e.expectedVariantCount++; },
    (e: BulkCatalogEvidence) => { e.download.expectedSha256 = "0".repeat(64); },
  ]) {
    const f = fixture(); mutate(f.evidence);
    await assert.rejects(parseBulkCatalog(chunks(f.raw), f.evidence, policy), /COMPLETENESS|HASH_MISMATCH/);
  }
});
test("validates IDs, fields, options and available product status", async () => {
  for (const mutate of [
    (v: ReturnType<typeof node>) => { v.id = "historical-key"; },
    (v: ReturnType<typeof node>) => { v.product.id = "gid://shopify/ProductVariant/1"; },
    (v: ReturnType<typeof node>) => { v.inventoryItem.id = "bad"; },
    (v: ReturnType<typeof node>) => { v.product.status = "NOT_A_STATUS"; },
    (v: ReturnType<typeof node>) => { v.product.status = ["ACTIVE"] as unknown as string; },
    (v: ReturnType<typeof node>) => { v.selectedOptions[0].name = ""; },
    (v: ReturnType<typeof node>) => { v.sku = 42 as unknown as string; },
    (v: ReturnType<typeof node>) => { v.product.title = null as unknown as string; },
  ]) {
    const v = node(1); mutate(v); const f = fixture([v]);
    await assert.rejects(parseBulkCatalog(chunks(f.raw), f.evidence, policy), /INVALID_/);
  }
  const v = node(1); v.product.status = "UNLISTED";
  const f = fixture([v]);
  assert.equal((await parseBulkCatalog(chunks(f.raw), f.evidence, policy)).identities[0].productStatus, "UNLISTED");
  v.product.status = undefined as unknown as string;
  const unknown = fixture([v]);
  assert.equal((await parseBulkCatalog(chunks(unknown.raw), unknown.evidence, policy)).identities[0].productStatus, null);
});
test("same-count variant replacement and same-ID product changes fail reconciliation", async () => {
  for (const change of [
    (v: ReturnType<typeof node>) => { v.id = "gid://shopify/ProductVariant/99"; },
    (v: ReturnType<typeof node>) => { v.product.title = "Different product identity"; },
  ]) {
    const f = await reconciledFixture();
    const changed = node(2); change(changed);
    // If a parent changed, represent its new identity consistently throughout
    // this download, so the independent manifest (not an intra-file conflict)
    // is what rejects the same-count change.
    const first = node(1); first.product = { ...changed.product };
    const raw = line(first) + line(changed);
    f.evidence.operation.fileSizeBytes = Buffer.byteLength(raw);
    await assert.rejects(parseBulkCatalog(chunks(raw), f.evidence, policy), /CATALOG_IDENTITY_RECONCILIATION_MISMATCH/);
  }
});
test("only independent matching identity evidence permits in-memory schema projection", async () => {
  const f = await reconciledFixture();
  const parsed = await parseBulkCatalog(chunks(f.raw), f.evidence, policy);
  assert.equal(parsed.reconciliationStatus, "matched");
  assert.equal(parsed.activationEligible, false);
  const rows = prepareBulkCatalogRows(parsed, policy);
  assert.equal(rows.length, 2); assert.equal(rows[0].sku, "SKU-1");
  assert.equal(rows[0].live_verified_at, f.evidence.download.downloadedAt);
  assert.match(rows[0].identity_fingerprint, /^[0-9a-f]{64}$/);
  parsed.identities[0].sku = "tampered";
  assert.throws(() => prepareBulkCatalogRows(parsed, policy), /BULK_RESULT_CHANGED_AFTER_VALIDATION/);
});
test("stale/future/misordered timestamps and self-referential reconciliation fail", async () => {
  for (const mutate of [
    (e: BulkCatalogEvidence) => { e.download.downloadedAt = "2020-01-01T00:00:00Z"; },
    (e: BulkCatalogEvidence) => { e.download.downloadedAt = "2030-01-01T00:00:00Z"; },
    (e: BulkCatalogEvidence) => { e.operation.completedAt = "2026-10-17T09:00:00Z"; },
    (e: BulkCatalogEvidence) => { e.download.downloadedAt = "2026-10-17T10:03:00"; },
    (e: BulkCatalogEvidence) => { e.reconciliation!.observationReference = e.operation.id; },
    (e: BulkCatalogEvidence) => { e.reconciliation!.observedAt = "2026-10-17T10:01:00Z"; },
  ]) {
    const f = await reconciledFixture(); mutate(f.evidence);
    await assert.rejects(parseBulkCatalog(chunks(f.raw), f.evidence, policy));
  }
});
test("resource limits, cancelled streams and producer failures cannot produce a catalog", async () => {
  const f = fixture();
  await assert.rejects(parseBulkCatalog(chunks(f.raw), f.evidence, { ...policy, maxLineBytes: 32 }), /BULK_LINE_LIMIT/);
  await assert.rejects(parseBulkCatalog(chunks(f.raw), f.evidence, { ...policy, maxRecords: 1 }), /BULK_RESOURCE_LIMIT/);
  await assert.rejects(parseBulkCatalog(chunks(f.raw, 256), f.evidence, { ...policy, maxChunkBytes: 128 }), /BULK_CHUNK_LIMIT/);
  const c = new AbortController(); c.abort();
  await assert.rejects(parseBulkCatalog(chunks(f.raw), f.evidence, { ...policy, signal: c.signal }), /BULK_PARSE_ABORTED/);
  async function* broken() { yield Buffer.from(line(node(1))); throw new Error("secret-looking upstream detail"); }
  await assert.rejects(parseBulkCatalog(broken(), f.evidence, policy), /^Error: BULK_STREAM_FAILED$/);
});
test("identity manifest is order independent but includes full product identity", async () => {
  const f = await reconciledFixture();
  const parsed = await parseBulkCatalog(chunks(f.raw), f.evidence, policy);
  assert.equal(catalogIdentityDigest(parsed.identities), catalogIdentityDigest([...parsed.identities].reverse()));
  assert.equal(parsed.identities[0].sku, "SKU-1");
});
test("empty complete results remain preview-only and cannot retire a catalog", async () => {
  const e = receipt(0, 0);
  e.reconciliation = { source: "independent_live_observation", observationReference: "separate-empty-fixture",
    shopDomain: e.shopDomain, querySha256: e.operation.querySha256, observedAt: "2026-10-17T10:04:00Z",
    variantCount: 0, identityDigestSha256: catalogIdentityDigest([]) };
  const parsed = await parseBulkCatalog(chunks(""), e, policy);
  assert.equal(parsed.activationEligible, false);
  assert.throws(() => prepareBulkCatalogRows(parsed, policy), /EMPTY_CATALOG_REQUIRES_EXPLICIT_REVIEW/);
});
