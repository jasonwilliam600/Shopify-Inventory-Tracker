import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogIdentityDigest } from "./catalog-reconciliation";
import { prepareCatalogRows, projectLiveCatalog, validateCompleteCatalog, type CompleteCatalogEvidence, type LiveCatalogIdentity } from "./shopify-catalog-contract";

const identity = (id: number, sku: string | null = " A1 "): LiveCatalogIdentity => ({
  shopDomain: "test-fixture.myshopify.com", productId: "gid://shopify/Product/1",
  variantId: `gid://shopify/ProductVariant/${id}`, inventoryItemId: null,
  sku, productTitle: "Fixture", variantTitle: "Default", vendor: "Example",
  options: [{ name: "Color", value: "Red" }], productStatus: "ACTIVE",
  verifiedAt: "2026-10-17T10:00:00Z",
});
function evidence(): CompleteCatalogEvidence {
  return { source: "live_shopify", shopDomain: identity(1).shopDomain,
    verifiedAt: identity(1).verifiedAt, scopes: ["read_products"], expectedVariantCount: 3,
    pages: [
      { identities: [identity(1)], pageInfo: { hasNextPage: true, endCursor: "cursor1" }, throttle: null },
      { identities: [identity(2, "a1"), identity(3, null)], pageInfo: { hasNextPage: false, endCursor: "cursor2" }, throttle: null },
    ] };
}
test("complete pagination retains original SKUs, duplicate destinations and missing SKUs without approval", () => {
  const result = validateCompleteCatalog(evidence());
  assert.deepEqual(result.map(v => v.skuStatus), ["duplicate", "duplicate", "missing"]);
  assert.equal(result[0].sku, " A1 ");
  assert.ok(result.every(v => v.relationshipVerified === false));
});
test("partial catalogs, count mismatch and absent completeness evidence fail closed", () => {
  for (const mutate of [
    (e: CompleteCatalogEvidence) => { e.pages[1].pageInfo.hasNextPage = true; },
    (e: CompleteCatalogEvidence) => { e.expectedVariantCount = 4; },
    (e: CompleteCatalogEvidence) => { e.pages = []; },
    (e: CompleteCatalogEvidence) => { e.expectedVariantCount = -1; },
  ]) { const e = evidence(); mutate(e); assert.throws(() => validateCompleteCatalog(e)); }
});
test("pagination cannot stop early or reuse an intermediate cursor", () => {
  const e = evidence();
  e.pages[0].pageInfo.hasNextPage = false;
  assert.throws(() => validateCompleteCatalog(e), /INCOMPLETE_PAGINATION/);
  const repeated = evidence();
  repeated.pages = [repeated.pages[0], { ...repeated.pages[0], identities: [] }, repeated.pages[1]];
  assert.throws(() => validateCompleteCatalog(repeated), /NON_ADVANCING_CURSOR/);
});
test("historical data, mixed shops/timestamps, duplicate GIDs and invalid GIDs are rejected", () => {
  for (const mutate of [
    (e: CompleteCatalogEvidence) => { (e as unknown as { source: string }).source = "historical"; },
    (e: CompleteCatalogEvidence) => { e.pages[0].identities[0].shopDomain = "other.myshopify.com"; },
    (e: CompleteCatalogEvidence) => { e.pages[0].identities[0].verifiedAt = "2026-10-16T10:00:00Z"; },
    (e: CompleteCatalogEvidence) => { e.pages[0].identities[0].variantId = "gid://shopify/ProductVariant/2"; },
    (e: CompleteCatalogEvidence) => { e.pages[0].identities[0].productId = "historical-key"; },
  ]) { const e = evidence(); mutate(e); assert.throws(() => validateCompleteCatalog(e)); }
});
test("product scopes must be independently verified, not inferred from shop connectivity", () => {
  const e = evidence(); e.scopes = ["read_inventory"];
  assert.throws(() => validateCompleteCatalog(e), /PRODUCT_SCOPE_UNVERIFIED/);
  e.scopes = ["write_products"];
  assert.equal(validateCompleteCatalog(e).length, 3);
});
test("projection uses variant GID identity, never SKU and never historical keys", () => {
  const result = projectLiveCatalog(evidence(), "fixture");
  assert.equal(result.length, 3);
  assert.equal(new Set(result.map(v => v.key)).size, 3);
  assert.ok(result.every(v => !v.historical && v.variantId.startsWith("gid://shopify/ProductVariant/")));
  assert.equal(projectLiveCatalog(evidence(), "no-such-product").length, 0);
});
test("malformed verification time and options fail before projection", () => {
  const e = evidence(); e.verifiedAt = "2026-10-17T10:00:00";
  assert.throws(() => validateCompleteCatalog(e), /INVALID_VERIFICATION_TIME/);
  const bad = evidence();
  bad.pages[0].identities[0].options = [{ name: "Color", value: null as unknown as string }];
  assert.throws(() => validateCompleteCatalog(bad), /INVALID_CATALOG_FIELDS/);
});
test("installed-table projection preserves original identities and fingerprints status changes without SQL", () => {
  const e = evidence();
  const policy = { nowMs: Date.parse("2026-10-17T10:05:00Z"), maxAgeMs: 3600_000 };
  e.querySha256 = "a".repeat(64);
  e.reconciliation = {
    source: "independent_live_observation", observationReference: "offline-fixture-observation",
    shopDomain: e.shopDomain, querySha256: e.querySha256, observedAt: "2026-10-17T10:01:00Z",
    variantCount: 3, identityDigestSha256: catalogIdentityDigest(validateCompleteCatalog(e)),
  };
  const rows = prepareCatalogRows(e, policy);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].sku, " A1 ");
  assert.match(rows[0].identity_fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(rows[0].variant_gid, identity(1).variantId);
  assert.deepEqual(rows[0].selected_options, identity(1).options);
  assert.equal(rows[0].live_verified_at, e.verifiedAt);
  e.pages[0].identities[0].productStatus = "DRAFT";
  assert.throws(() => prepareCatalogRows(e, policy), /CATALOG_IDENTITY_RECONCILIATION_MISMATCH/);
  e.reconciliation.identityDigestSha256 = catalogIdentityDigest(validateCompleteCatalog(e));
  assert.notEqual(prepareCatalogRows(e, policy)[0].identity_fingerprint, rows[0].identity_fingerprint);
});
test("cursor evidence cannot prepare rows without independent reconciliation and freshness policy", () => {
  assert.throws(() => prepareCatalogRows(evidence()), /CATALOG_RECONCILIATION_REQUIRED/);
  assert.throws(() => prepareCatalogRows(evidence(), { nowMs: Date.now(), maxAgeMs: 3600_000 }), /CATALOG_RECONCILIATION_REQUIRED/);
});
test("terminal pagination values require an actual boolean", () => {
  for (const value of [undefined, null, "false", 0]) {
    const e = evidence();
    (e.pages[1].pageInfo as unknown as { hasNextPage: unknown }).hasNextPage = value;
    assert.throws(() => validateCompleteCatalog(e), /INCOMPLETE_PAGINATION/);
  }
});
