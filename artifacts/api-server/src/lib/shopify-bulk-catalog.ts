import { createHash } from "node:crypto";
import { catalogIdentityDigest, catalogInstant, requireCatalogReconciliation, SHA256_PATTERN } from "./catalog-reconciliation";
import type { LiveCatalogIdentity } from "./shopify-catalog-contract";
import type { BulkCatalogEvidence, BulkValidationPolicy, ParsedBulkCatalog } from "./shopify-bulk-catalog-contract";

type Obj = Record<string, unknown>;
type Product = Pick<LiveCatalogIdentity, "productId" | "productTitle" | "vendor" | "productStatus">;
type Variant = Pick<LiveCatalogIdentity, "variantId" | "inventoryItemId" | "sku" | "variantTitle" | "options"> & { productId: string };
const gid = (value: unknown, kind: string): string => {
  if (typeof value !== "string" || !new RegExp(`^gid://shopify/${kind}/[0-9]+$`).test(value)) throw new Error(`INVALID_${kind.toUpperCase()}_ID`);
  return value;
};
function obj(value: unknown): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_BULK_RECORD");
  return value as Obj;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("INVALID_BULK_TEXT");
  return value;
}
function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}
function product(value: unknown): Product {
  const p = obj(value);
  const status = p.status ?? null;
  if (status !== null && (typeof status !== "string" || !["ACTIVE", "DRAFT", "ARCHIVED", "UNLISTED"].includes(status))) throw new Error("INVALID_PRODUCT_STATUS");
  if (p.__typename !== undefined && p.__typename !== "Product") throw new Error("INVALID_PRODUCT_TYPENAME");
  return { productId: gid(p.id, "Product"), productTitle: text(p.title), vendor: nullableText(p.vendor),
    productStatus: status as Product["productStatus"] };
}
function variant(v: Obj, productId: string): Variant {
  if (v.__typename !== undefined && v.__typename !== "ProductVariant") throw new Error("INVALID_VARIANT_TYPENAME");
  if (!Array.isArray(v.selectedOptions)) throw new Error("INVALID_VARIANT_OPTIONS");
  const names = new Set<string>();
  const options = v.selectedOptions.map(value => {
    const option = obj(value);
    const name = text(option.name);
    if (!name || names.has(name)) throw new Error("INVALID_VARIANT_OPTIONS");
    names.add(name);
    return { name, value: text(option.value) };
  });
  return { variantId: gid(v.id, "ProductVariant"), productId,
    inventoryItemId: v.inventoryItem == null ? null : gid(obj(v.inventoryItem).id, "InventoryItem"),
    sku: nullableText(v.sku), variantTitle: text(v.title), options };
}
function integer(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }

/** Receipt validation only. The caller must obtain receipts through a trusted path. */
export function validateBulkEvidence(e: BulkCatalogEvidence, p: BulkValidationPolicy): void {
  if (e.source !== "live_shopify" || e.retrievalMode !== "bulk") throw new Error("HISTORICAL_OR_NON_BULK_SOURCE");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(e.shopDomain)
    || e.apiVersion !== "2026-07" || !["variant_roots", "products_with_variants"].includes(e.layout)) throw new Error("INVALID_BULK_PROVENANCE");
  if (!Array.isArray(e.scopes) || !e.scopes.some(s => s === "read_products" || s === "write_products")) throw new Error("PRODUCT_SCOPE_UNVERIFIED");
  const o = e.operation;
  if (!o || !/^gid:\/\/shopify\/BulkOperation\/[0-9]+$/.test(o.id)
    || o.type !== "QUERY" || o.status !== "COMPLETED" || o.errorCode !== null) throw new Error("BULK_OPERATION_NOT_COMPLETE");
  const d = e.download;
  if (!d || d.source !== "shopify_bulk_query_result" || d.resultKind !== "complete" || d.transportComplete !== true
    || d.operationId !== o.id || d.shopDomain !== e.shopDomain || d.querySha256 !== o.querySha256
    || !SHA256_PATTERN.test(o.querySha256) || !SHA256_PATTERN.test(d.resultUrlSha256)
    || (d.expectedSha256 !== undefined && !SHA256_PATTERN.test(d.expectedSha256))) throw new Error("INVALID_DOWNLOAD_PROVENANCE");
  const start = catalogInstant(o.createdAt), end = catalogInstant(o.completedAt), downloaded = catalogInstant(d.downloadedAt);
  if (!Number.isFinite(p.nowMs) || !Number.isFinite(p.maxAgeMs) || p.maxAgeMs <= 0
    || start > end || end > downloaded || downloaded > p.nowMs || p.nowMs - downloaded > p.maxAgeMs
    || downloaded - end > 7 * 24 * 60 * 60_000) throw new Error("STALE_OR_INVALID_BULK_TIME");
  if (![e.expectedVariantCount, o.rootObjectCount, o.objectCount, o.fileSizeBytes].every(integer)
    || o.objectCount < o.rootObjectCount) throw new Error("INVALID_BULK_COUNTS");
}

/**
 * Streaming input, bounded line/chunk buffering. Retains normalized identities
 * and indexes (O(variants)), never the complete raw JSONL download.
 * Supports variant roots or ungrouped products + __parentId variant records.
 * No network/credential/database dependencies or callbacks.
 */
export async function parseBulkCatalog(
  chunks: AsyncIterable<Uint8Array>, evidence: BulkCatalogEvidence, policy: BulkValidationPolicy,
): Promise<ParsedBulkCatalog> {
  // Detach receipts from caller mutation while awaiting a stream.
  const e: BulkCatalogEvidence = structuredClone(evidence);
  const p = { ...policy };
  validateBulkEvidence(e, p);
  const maxLine = p.maxLineBytes ?? 1024 * 1024;
  const maxChunk = p.maxChunkBytes ?? 1024 * 1024;
  const maxFile = p.maxFileBytes ?? 2 * 1024 * 1024 * 1024;
  const maxRecords = p.maxRecords ?? 1_000_000;
  if (![maxLine, maxChunk, maxFile, maxRecords].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error("INVALID_BULK_LIMITS");
  if (e.operation.fileSizeBytes > maxFile || e.operation.objectCount > maxRecords) throw new Error("BULK_RESOURCE_LIMIT");
  const products = new Map<string, Product>();
  const variants = new Map<string, Variant>();
  const hash = createHash("sha256");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, records = 0, roots = 0, pending = "";
  const consume = (line: string) => {
    if (p.signal?.aborted) throw new Error("BULK_PARSE_ABORTED");
    if (Buffer.byteLength(line, "utf8") > maxLine) throw new Error("BULK_LINE_LIMIT");
    let raw: Obj;
    try { raw = obj(JSON.parse(line.endsWith("\r") ? line.slice(0, -1) : line)); }
    catch { throw new Error("MALFORMED_BULK_JSONL"); }
    if (++records > maxRecords) throw new Error("BULK_RESOURCE_LIMIT");
    if (e.layout === "variant_roots") {
      if (raw.__parentId !== undefined) throw new Error("UNEXPECTED_BULK_PARENT");
      const parent = product(raw.product);
      const prior = products.get(parent.productId);
      if (prior && JSON.stringify(prior) !== JSON.stringify(parent)) throw new Error("INCONSISTENT_PRODUCT_IDENTITY");
      products.set(parent.productId, parent);
      const v = variant(raw, parent.productId);
      if (variants.has(v.variantId)) throw new Error("DUPLICATE_VARIANT_ID");
      variants.set(v.variantId, v); roots++;
    } else if (typeof raw.id === "string" && /^gid:\/\/shopify\/Product\/[0-9]+$/.test(raw.id)) {
      if (raw.__parentId !== undefined) throw new Error("UNEXPECTED_BULK_PARENT");
      const parent = product(raw);
      if (products.has(parent.productId)) throw new Error("DUPLICATE_PRODUCT_ID");
      products.set(parent.productId, parent); roots++;
    } else {
      const parentId = gid(raw.__parentId, "Product");
      if (raw.product !== undefined && gid(obj(raw.product).id, "Product") !== parentId) throw new Error("CONFLICTING_BULK_PARENT");
      const v = variant(raw, parentId);
      if (variants.has(v.variantId)) throw new Error("DUPLICATE_VARIANT_ID");
      variants.set(v.variantId, v);
    }
  };
  try {
    for await (const chunk of chunks) {
      if (p.signal?.aborted) throw new Error("BULK_PARSE_ABORTED");
      if (!(chunk instanceof Uint8Array) || chunk.byteLength > maxChunk) throw new Error("BULK_CHUNK_LIMIT");
      bytes += chunk.byteLength;
      if (bytes > maxFile || bytes > e.operation.fileSizeBytes) throw new Error("BULK_BYTE_COUNT_MISMATCH");
      hash.update(chunk);
      pending += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        consume(pending.slice(0, newline)); pending = pending.slice(newline + 1);
      }
      if (Buffer.byteLength(pending, "utf8") > maxLine) throw new Error("BULK_LINE_LIMIT");
    }
    pending += decoder.decode();
  } catch (error) {
    if (error instanceof Error && /^(BULK_|INVALID_|MALFORMED_|DUPLICATE_|UNEXPECTED_|INCONSISTENT_|CONFLICTING_)/.test(error.message)) throw error;
    throw new Error("BULK_STREAM_FAILED");
  }
  if (pending) consume(pending); // A final newline is not required by JSONL.
  if (p.signal?.aborted) throw new Error("BULK_PARSE_ABORTED");
  const downloadSha256 = hash.digest("hex");
  if (bytes !== e.operation.fileSizeBytes || records !== e.operation.objectCount
    || roots !== e.operation.rootObjectCount || variants.size !== e.expectedVariantCount) throw new Error("BULK_COMPLETENESS_MISMATCH");
  if (e.download.expectedSha256 && downloadSha256 !== e.download.expectedSha256) throw new Error("BULK_DOWNLOAD_HASH_MISMATCH");
  const skuCounts = new Map<string, number>();
  for (const v of variants.values()) {
    const sku = v.sku?.trim().toUpperCase();
    if (sku) skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1);
  }
  const identities: ParsedBulkCatalog["identities"] = [];
  for (const v of variants.values()) {
    const parent = products.get(v.productId);
    if (!parent) throw new Error("ORPHAN_BULK_VARIANT");
    const sku = v.sku?.trim().toUpperCase();
    identities.push({ ...parent, ...v, shopDomain: e.shopDomain, verifiedAt: e.download.downloadedAt,
      skuStatus: !sku ? "missing" : (skuCounts.get(sku) ?? 0) > 1 ? "duplicate" : "unique",
      relationshipVerified: false });
  }
  if (e.reconciliation) requireCatalogReconciliation({
    ...e, identities, verifiedAt: e.download.downloadedAt, operationId: e.operation.id,
    querySha256: e.operation.querySha256, nowMs: p.nowMs, maxAgeMs: p.maxAgeMs,
  });
  return { evidence: e, identities,
    receipt: { byteCount: bytes, recordCount: records, rootObjectCount: roots, variantCount: identities.length,
      downloadSha256, identityDigestSha256: catalogIdentityDigest(identities) },
    reconciliationStatus: e.reconciliation ? "matched" : "required", activationEligible: false };
}

/** In-memory rows only; never writes, activates, resolves holds or approves. */
export function prepareBulkCatalogRows(parsed: ParsedBulkCatalog, policy: BulkValidationPolicy) {
  validateBulkEvidence(parsed.evidence, policy);
  const e = parsed.evidence;
  if (parsed.identities.length !== e.expectedVariantCount || parsed.receipt.identityDigestSha256 !== catalogIdentityDigest(parsed.identities)) throw new Error("BULK_RESULT_CHANGED_AFTER_VALIDATION");
  requireCatalogReconciliation({ ...e, identities: parsed.identities, verifiedAt: e.download.downloadedAt,
    operationId: e.operation.id, querySha256: e.operation.querySha256, nowMs: policy.nowMs, maxAgeMs: policy.maxAgeMs });
  if (parsed.identities.length === 0) throw new Error("EMPTY_CATALOG_REQUIRES_EXPLICIT_REVIEW");
  return parsed.identities.map(v => ({
    shop_domain: v.shopDomain, variant_gid: v.variantId, product_gid: v.productId,
    inventory_item_gid: v.inventoryItemId, sku: v.sku, title: `${v.productTitle} · ${v.variantTitle}`,
    vendor: v.vendor, selected_options: v.options.map(o => ({ ...o })),
    identity_fingerprint: catalogIdentityDigest([v]), live_verified_at: e.download.downloadedAt, active: true,
  }));
}
