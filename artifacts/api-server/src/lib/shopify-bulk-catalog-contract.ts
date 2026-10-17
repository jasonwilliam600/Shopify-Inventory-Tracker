import type { CatalogReconciliation } from "./catalog-reconciliation";
import type { LiveCatalogIdentity } from "./shopify-catalog-contract";

/** No cursors: these are completed bulk-operation/download receipts. */
export interface BulkCatalogEvidence {
  source: "live_shopify";
  retrievalMode: "bulk";
  apiVersion: "2026-07";
  layout: "variant_roots" | "products_with_variants";
  shopDomain: string;
  scopes: readonly string[];
  expectedVariantCount: number;
  operation: {
    id: string;
    type: "QUERY";
    status: "COMPLETED";
    errorCode: null;
    createdAt: string;
    completedAt: string;
    querySha256: string;
    rootObjectCount: number;
    objectCount: number;
    fileSizeBytes: number;
  };
  download: {
    source: "shopify_bulk_query_result";
    resultKind: "complete";
    operationId: string;
    shopDomain: string;
    querySha256: string;
    resultUrlSha256: string;
    downloadedAt: string;
    transportComplete: true;
    expectedSha256?: string;
  };
  reconciliation?: CatalogReconciliation;
}

export interface BulkValidationPolicy {
  /** Explicit policy, not a fabricated current-catalog timestamp. */
  nowMs: number;
  maxAgeMs: number;
  maxFileBytes?: number;
  maxLineBytes?: number;
  maxChunkBytes?: number;
  maxRecords?: number;
  signal?: AbortSignal;
}

export interface ParsedBulkCatalog {
  evidence: BulkCatalogEvidence;
  identities: (LiveCatalogIdentity & {
    skuStatus: "unique" | "duplicate" | "missing";
    relationshipVerified: false;
  })[];
  receipt: {
    byteCount: number;
    recordCount: number;
    rootObjectCount: number;
    variantCount: number;
    downloadSha256: string;
    identityDigestSha256: string;
  };
  reconciliationStatus: "required" | "matched";
  /** Parsing, even with matching evidence, never authorizes a database import. */
  activationEligible: false;
}
