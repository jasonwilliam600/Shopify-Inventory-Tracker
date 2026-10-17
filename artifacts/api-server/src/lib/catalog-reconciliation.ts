import { createHash } from "node:crypto";
import type { LiveCatalogIdentity } from "./shopify-catalog-contract";

export interface CatalogReconciliation {
  source: "independent_live_observation";
  observationReference: string;
  shopDomain: string;
  querySha256: string;
  observedAt: string;
  variantCount: number;
  identityDigestSha256: string;
}

export const SHA256_PATTERN = /^[a-f0-9]{64}$/;
export function catalogInstant(value: unknown): number {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error("INVALID_CATALOG_TIME");
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error("INVALID_CATALOG_TIME");
  return time;
}

/** Order-independent manifest of complete identities, not merely SKU/row counts. */
export function catalogIdentityDigest(identities: readonly LiveCatalogIdentity[]): string {
  const hash = createHash("sha256");
  for (const v of [...identities].sort((a, b) => a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0)) {
    const options = [...v.options].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    hash.update(JSON.stringify([v.shopDomain, v.variantId, v.productId, v.inventoryItemId,
      v.sku, v.productTitle, v.variantTitle, v.vendor, options, v.productStatus]) + "\n");
  }
  return hash.digest("hex");
}

/** Validates evidence supplied by a future trusted observer; does not obtain it. */
export function requireCatalogReconciliation(input: {
  reconciliation?: CatalogReconciliation;
  shopDomain: string; querySha256?: string; verifiedAt: string;
  identities: readonly LiveCatalogIdentity[];
  nowMs: number; maxAgeMs: number; operationId?: string;
}): void {
  const r = input.reconciliation;
  if (!r) throw new Error("CATALOG_RECONCILIATION_REQUIRED");
  if (!Number.isFinite(input.nowMs) || !Number.isFinite(input.maxAgeMs) || input.maxAgeMs <= 0) throw new Error("INVALID_FRESHNESS_POLICY");
  if (!input.querySha256 || !SHA256_PATTERN.test(input.querySha256)
    || r.source !== "independent_live_observation" || !r.observationReference?.trim()
    || r.observationReference === input.operationId || r.shopDomain !== input.shopDomain
    || r.querySha256 !== input.querySha256) throw new Error("INVALID_RECONCILIATION_PROVENANCE");
  const observedAt = catalogInstant(r.observedAt);
  const verifiedAt = catalogInstant(input.verifiedAt);
  if (observedAt < verifiedAt || observedAt > input.nowMs || verifiedAt > input.nowMs
    || input.nowMs - verifiedAt > input.maxAgeMs) throw new Error("STALE_OR_INVALID_RECONCILIATION");
  if (!Number.isSafeInteger(r.variantCount) || r.variantCount !== input.identities.length
    || !SHA256_PATTERN.test(r.identityDigestSha256)
    || r.identityDigestSha256 !== catalogIdentityDigest(input.identities)) {
    throw new Error("CATALOG_IDENTITY_RECONCILIATION_MISMATCH");
  }
}
