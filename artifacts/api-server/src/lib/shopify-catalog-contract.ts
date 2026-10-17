import { catalogIdentityDigest, requireCatalogReconciliation, type CatalogReconciliation } from "./catalog-reconciliation";
export type { BulkCatalogEvidence, BulkValidationPolicy, ParsedBulkCatalog } from "./shopify-bulk-catalog-contract";

/**
 * Transport-free catalog boundary. No auth, network, SQL writer, scheduler or
 * product/quantity mutation exists here. A permitted provider is still required.
 */
export interface LiveCatalogIdentity {
  shopDomain: string;
  productId: string;
  variantId: string;
  inventoryItemId: string | null;
  sku: string | null;
  productTitle: string;
  variantTitle: string;
  vendor: string | null;
  options: { name: string; value: string }[];
  productStatus: "ACTIVE" | "DRAFT" | "ARCHIVED" | "UNLISTED" | null;
  verifiedAt: string;
}

export interface CatalogReadPage {
  identities: LiveCatalogIdentity[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  /** A provider must throw on HTTP/GraphQL errors, never return partial data. */
  throttle: { currentlyAvailable: number; restoreRate: number; requestedCost: number } | null;
}

/** Interface only: deliberately not connected to the existing auth helper. */
export interface ShopifyCatalogReadPort {
  readPage(request: { after: string | null; first: 100; signal: AbortSignal }): Promise<CatalogReadPage>;
}

export interface CompleteCatalogEvidence {
  source: "live_shopify";
  retrievalMode?: "cursor";
  querySha256?: string;
  reconciliation?: CatalogReconciliation;
  shopDomain: string;
  verifiedAt: string;
  scopes: readonly string[];
  /** Exact variant count obtained independently during the same retrieval. */
  expectedVariantCount: number;
  pages: readonly CatalogReadPage[];
}

function instant(value: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

/**
 * Validate a finished retrieval in memory before any future DB transaction.
 * This is NOT an import authorization, database activation or mapping approval.
 */
export function validateCompleteCatalog(evidence: CompleteCatalogEvidence) {
  if (evidence.source !== "live_shopify") throw new Error("HISTORICAL_SOURCE_FORBIDDEN");
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(evidence.shopDomain)) throw new Error("INVALID_SHOP_IDENTITY");
  if (!instant(evidence.verifiedAt)) throw new Error("INVALID_VERIFICATION_TIME");
  if (!evidence.scopes.some(s => s === "read_products" || s === "write_products")) throw new Error("PRODUCT_SCOPE_UNVERIFIED");
  if (!Number.isSafeInteger(evidence.expectedVariantCount) || evidence.expectedVariantCount < 0 || evidence.pages.length === 0) throw new Error("COMPLETENESS_UNPROVEN");
  const cursors = new Set<string>();
  const variants = new Set<string>();
  const identities: LiveCatalogIdentity[] = [];
  evidence.pages.forEach((page, pageIndex) => {
    const last = pageIndex === evidence.pages.length - 1;
    if (typeof page.pageInfo?.hasNextPage !== "boolean" || page.pageInfo.hasNextPage === last) throw new Error("INCOMPLETE_PAGINATION");
    if (page.pageInfo.endCursor !== null && typeof page.pageInfo.endCursor !== "string") throw new Error("INVALID_CURSOR");
    if (!last && (!page.pageInfo.endCursor || cursors.has(page.pageInfo.endCursor))) throw new Error("NON_ADVANCING_CURSOR");
    if (page.pageInfo.endCursor) cursors.add(page.pageInfo.endCursor);
    for (const identity of page.identities) {
      if (identity.shopDomain !== evidence.shopDomain || identity.verifiedAt !== evidence.verifiedAt) throw new Error("MIXED_CATALOG_SNAPSHOT");
      if (!/^gid:\/\/shopify\/Product\/[0-9]+$/.test(identity.productId)
        || !/^gid:\/\/shopify\/ProductVariant\/[0-9]+$/.test(identity.variantId)
        || (identity.inventoryItemId !== null && !/^gid:\/\/shopify\/InventoryItem\/[0-9]+$/.test(identity.inventoryItemId))) throw new Error("INVALID_SHOPIFY_IDENTITY");
      if (variants.has(identity.variantId)) throw new Error("DUPLICATE_VARIANT_ID");
      if (identity.sku !== null && typeof identity.sku !== "string") throw new Error("INVALID_SKU");
      if (typeof identity.productTitle !== "string" || typeof identity.variantTitle !== "string"
        || (identity.vendor !== null && typeof identity.vendor !== "string")
        || (identity.productStatus !== null && !["ACTIVE", "DRAFT", "ARCHIVED", "UNLISTED"].includes(identity.productStatus))
        || !Array.isArray(identity.options) || identity.options.some(o => typeof o.name !== "string" || typeof o.value !== "string")) throw new Error("INVALID_CATALOG_FIELDS");
      variants.add(identity.variantId);
      identities.push(identity);
    }
  });
  if (identities.length !== evidence.expectedVariantCount) throw new Error("CATALOG_COUNT_MISMATCH");
  // Normalize for collision detection only. Never change the stored original SKU.
  const skuCounts = new Map<string, number>();
  for (const v of identities) {
    const sku = v.sku?.trim().toUpperCase();
    if (sku) skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1);
  }
  return identities.map(v => ({
    ...v,
    skuStatus: !v.sku?.trim() ? "missing" as const
      : (skuCounts.get(v.sku.trim().toUpperCase()) ?? 0) > 1 ? "duplicate" as const : "unique" as const,
    relationshipVerified: false as const,
  }));
}

/** Prepared projection only; no database writes. GID, never SKU, is identity. */
export function projectLiveCatalog(evidence: CompleteCatalogEvidence, search: string) {
  const term = search.trim().toLowerCase();
  return validateCompleteCatalog(evidence).filter(v =>
    [v.sku ?? "", v.productTitle, v.variantTitle, v.vendor ?? "", v.variantId, ...v.options.map(o => o.value)]
      .some(text => text.toLowerCase().includes(term)),
  ).map(v => ({
    key: `${v.shopDomain}:${v.variantId}`, variantId: v.variantId,
    productId: v.productId, inventoryItemId: v.inventoryItemId,
    sku: v.sku ?? "", title: `${v.productTitle} · ${v.variantTitle}`,
    productTitle: v.productTitle, variantTitle: v.variantTitle, productStatus: v.productStatus,
    vendor: v.vendor ?? "", options: v.options.map(o => `${o.name}: ${o.value}`),
    skuStatus: v.skuStatus, historical: false, verifiedAt: v.verifiedAt,
  }));
}

/**
 * Exact existing table projection, in memory only. A separately authorized
 * importer must persist every row and retire absent variants in ONE transaction.
 * Do not persist an empty snapshot without explicit confirmation.
 */
export function prepareCatalogRows(evidence: CompleteCatalogEvidence, policy?: { nowMs: number; maxAgeMs: number }) {
  const identities = validateCompleteCatalog(evidence);
  if (!policy) throw new Error("CATALOG_RECONCILIATION_REQUIRED");
  requireCatalogReconciliation({ ...evidence, identities, ...policy });
  if (identities.length === 0) throw new Error("EMPTY_CATALOG_REQUIRES_EXPLICIT_REVIEW");
  return identities.map(v => ({
    shop_domain: v.shopDomain,
    variant_gid: v.variantId,
    product_gid: v.productId,
    inventory_item_gid: v.inventoryItemId,
    sku: v.sku,
    title: `${v.productTitle} · ${v.variantTitle}`,
    vendor: v.vendor,
    selected_options: v.options.map(o => ({ name: o.name, value: o.value })),
    identity_fingerprint: catalogIdentityDigest([v]),
    live_verified_at: v.verifiedAt,
    active: true,
  }));
}
