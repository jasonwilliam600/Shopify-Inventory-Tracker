/**
 * Offline comparison of TWO separately collected, provenance-complete bulk
 * observations. No requests, jobs, SQL, source-field fabrication or activation.
 */
import { catalogIdentityDigest, catalogInstant, type CatalogReconciliation } from "./catalog-reconciliation";
import { validateBulkEvidence, prepareBulkCatalogRows } from "./shopify-bulk-catalog";
import type { ParsedBulkCatalog, BulkValidationPolicy } from "./shopify-bulk-catalog-contract";

function check(snapshot: ParsedBulkCatalog, policy: BulkValidationPolicy): void {
  validateBulkEvidence(snapshot.evidence, policy);
  const ids = new Set<string>();
  for (const v of snapshot.identities) {
    if (v.shopDomain !== snapshot.evidence.shopDomain || ids.has(v.variantId)) throw new Error("RECONCILIATION_INVALID_IDENTITIES");
    ids.add(v.variantId);
  }
  if (snapshot.identities.length !== snapshot.evidence.expectedVariantCount
    || snapshot.receipt.variantCount !== snapshot.identities.length
    || snapshot.receipt.identityDigestSha256 !== catalogIdentityDigest(snapshot.identities)) {
    throw new Error("RECONCILIATION_INVALID_MANIFEST");
  }
}
export function reconcileIndependentBulkSnapshots(
  candidate: ParsedBulkCatalog, independent: ParsedBulkCatalog, policy: BulkValidationPolicy,
): { evidence: CatalogReconciliation; identitiesMatch: true; authorizesImport: false } {
  check(candidate, policy); check(independent, policy);
  const a = candidate.evidence, b = independent.evidence;
  if (a.operation.id === b.operation.id) throw new Error("RECONCILIATION_NOT_INDEPENDENT");
  if (a.shopDomain !== b.shopDomain || a.apiVersion !== b.apiVersion
    || a.operation.querySha256 !== b.operation.querySha256) throw new Error("RECONCILIATION_SOURCE_MISMATCH");
  // Require the independent job itself to start after candidate download,
  // stronger than merely observing its old result at a later timestamp.
  if (catalogInstant(b.operation.createdAt) < catalogInstant(a.download.downloadedAt)) {
    throw new Error("RECONCILIATION_OBSERVATION_TOO_EARLY");
  }
  if (candidate.identities.length !== independent.identities.length
    || candidate.receipt.identityDigestSha256 !== independent.receipt.identityDigestSha256) {
    throw new Error("CATALOG_IDENTITY_RECONCILIATION_MISMATCH");
  }
  const evidence: CatalogReconciliation = {
    source: "independent_live_observation", observationReference: b.operation.id,
    shopDomain: a.shopDomain, querySha256: a.operation.querySha256,
    observedAt: b.download.downloadedAt, variantCount: independent.identities.length,
    identityDigestSha256: independent.receipt.identityDigestSha256,
  };
  // Exercise the unchanged final preparation gate; no database writes occur.
  prepareBulkCatalogRows({ ...candidate, evidence: { ...a, reconciliation: evidence } }, policy);
  return { evidence, identitiesMatch: true, authorizesImport: false };
}
