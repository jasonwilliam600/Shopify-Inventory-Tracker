/** Pure calculation only: no database, authentication, network or mutation calls. */
import { createHash, randomUUID } from "node:crypto";
import { quantityObservation } from "./supplier-availability";
import { mappingHold } from "./supplier-mapping-policy";
import { moneyCents } from "./synchronization-money";
export { moneyCents } from "./synchronization-money";
import { verifiedUnitCost } from "./supplier-verified-cost";
import { prepareSupplierMetafields } from "./supplier-variant-metafields";
import { SYNC_SUPPLIERS, type SyncPolicy, type SyncSnapshot, type SyncMapping, type SupplierSyncOffer,
  type SyncPlan, type SyncOperation, type VariantSupplierVisibility, type SupplierVisibilityRow } from "./synchronization-types";
// Canonical object ordering survives JSONB round trips; arrays remain ordered.
export const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v, (_key, value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value)).digest("hex");
const fail = (code: string): never => { throw new Error(code); };
const generatedPlans = new WeakSet<object>();
export function assertGeneratedSyncPlan(plan: SyncPlan): void {
  const { digest: actual, ...body } = plan;
  if (!generatedPlans.has(plan) || actual !== digest(body)) fail("UNVALIDATED_SYNC_PLAN");
}
const integer = (v: number, min = 0) => Number.isSafeInteger(v) && v >= min;
const inventoryTimestamp = (value: Date | string | null): number =>
  value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
const ceilDivide = (n: bigint, d: bigint) => Number((n + d - 1n) / d);
const priceString = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
function validatePolicy(p: SyncPolicy): void {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(p.shopDomain)
    || !/^gid:\/\/shopify\/Location\/[1-9]\d*$/.test(p.locationId) || p.currency !== "USD"
    || p.selection !== "combine" || typeof p.supplierMetafields !== "boolean"
    || !SYNC_SUPPLIERS.every(s => integer(p.maxAgeMinutes[s], 1))
    || !integer(p.safetyStock) || !integer(p.maxQuantity, 1)
    || !integer(p.maxChangedVariants, 1) || !integer(p.maxZeroedVariants)
    || !integer(p.maxQuantityDelta) || !integer(p.maxPriceChangeBasisPoints)
    || !integer(p.maxPlanAgeSeconds, 1) || p.maxPlanAgeSeconds > 300
    || !["hold", "use_floor"].includes(p.lowerBounds)) fail("INVALID_SYNC_POLICY");
  if (p.pricing.mode !== "preserve" && (!["margin", "markup"].includes(p.pricing.mode)
    || !integer(p.pricing.basisPoints) || p.pricing.basisPoints > (p.pricing.mode === "margin" ? 9999 : 100000))) fail("INVALID_PRICING_POLICY");
}
export function buildSyncPlan(input: { policy: SyncPolicy; snapshot: SyncSnapshot;
  mappings: readonly SyncMapping[]; offers: readonly SupplierSyncOffer[]; nowMs?: number;
  target?: "shopify_api" | "matrixify_export" }): SyncPlan {
  const { policy: p, snapshot: s, mappings, offers } = input, now = input.nowMs ?? Date.now();
  validatePolicy(p);
  if (!Number.isFinite(now)) fail("INVALID_SYNC_TIME");
  const blockers: string[] = [], holds: SyncPlan["holds"][number][] = [], operations: SyncOperation[] = [];
  const supplierVisibility: VariantSupplierVisibility[] = [];
  const verification = Date.parse(s.verifiedAt);
  if (!s.complete || s.shopDomain !== p.shopDomain || s.currency !== p.currency
    || !Number.isFinite(verification) || verification > now || now - verification > p.maxPlanAgeSeconds * 1000) blockers.push("CURRENT_COMPLETE_SHOP_SNAPSHOT_REQUIRED");
  const required = ["read_products", "read_inventory", "read_locations", "write_inventory"];
  if (p.pricing.mode !== "preserve" || p.supplierMetafields) required.push("write_products");
  // An offline file does not make Admin API requests or acquire API authority.
  // Its target is fingerprinted and is explicitly refused by the API executor.
  if (input.target !== "matrixify_export" && required.some(scope => !s.scopes.includes(scope))) blockers.push("SHOPIFY_SCOPES_MISSING");
  if (!s.variants.length || new Set(s.variants.map(v => v.variantId)).size !== s.variants.length
    || new Set(s.variants.map(v => v.inventoryItemId)).size !== s.variants.length) blockers.push("INVALID_CATALOG_IDENTITIES");
  let expires = Number.isFinite(verification) ? Math.min(now + p.maxPlanAgeSeconds * 1000, verification + p.maxPlanAgeSeconds * 1000) : now;
  const skuCounts = new Map<string, number>(), sourceMappings = new Map<string, number>(), offerIndex = new Map<string, SupplierSyncOffer[]>();
  const sourceKey = (supplier: string, sku: string) => JSON.stringify([supplier, sku]);
  for (const v of s.variants) skuCounts.set(v.sku.trim().toUpperCase(), (skuCounts.get(v.sku.trim().toUpperCase()) ?? 0) + 1);
  for (const m of mappings.filter(m => m.state === "approved")) {
    const key = sourceKey(m.supplier, m.originalSku); sourceMappings.set(key, (sourceMappings.get(key) ?? 0) + 1);
  }
  for (const o of offers) {
    const key = sourceKey(o.source.supplier, o.source.sku), rows = offerIndex.get(key) ?? [];
    rows.push(o); offerIndex.set(key, rows);
  }
  for (const v of s.variants) {
    const hold = (code: string, m?: SyncMapping) => holds.push({ variantId: v.variantId, code,
      ...(m ? { supplier: m.supplier, originalSku: m.originalSku } : {}) });
    if (!/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(v.variantId)
      || !/^gid:\/\/shopify\/Product\/[1-9]\d*$/.test(v.productId)
      || !/^gid:\/\/shopify\/InventoryItem\/[1-9]\d*$/.test(v.inventoryItemId)
      || !/^[a-f0-9]{64}$/.test(v.identityFingerprint)) { hold("INVALID_VARIANT_IDENTITY"); continue; }
    if (!v.sku.trim()) { hold("MISSING_SHOPIFY_SKU"); continue; }
    if (skuCounts.get(v.sku.trim().toUpperCase()) !== 1) { hold("DUPLICATE_SHOPIFY_SKU"); continue; }
    if (!v.active) hold("INACTIVE_PRODUCT");
    const locationReady = v.tracked && v.locationActive && v.locationId === p.locationId && integer(v.quantity);
    if (!locationReady) hold("INVENTORY_LOCATION_OR_TRACKING_UNVERIFIED");
    const commitmentReady = v.committedQuantity !== null && integer(v.committedQuantity);
    if (!commitmentReady) hold("SHOPIFY_COMMITTED_QUANTITY_REQUIRED");
    const inventoryReady = v.active && locationReady && commitmentReady;
    const allRelated = mappings.filter(m => m.variantId === v.variantId);
    const related = allRelated.filter(m => m.state === "approved");
    if (!related.length) hold("APPROVED_MAPPING_REQUIRED");
    const collision = new Set(related.map(m => m.supplier)).size !== related.length;
    if (collision) hold("SAME_SUPPLIER_COLLISION");
    const rows: SupplierVisibilityRow[] = SYNC_SUPPLIERS.map(supplier => ({
      supplier, originalSku: null, mappingStatus: "unmatched", quantity: null, quantityKind: "unknown",
      quantityStatus: "unknown", eligible: false, pricingEligible: false, lastSuccessfulInventoryUpdate: null, verifiedCost: null,
    }));
    const eligible: { m: SyncMapping; offer: SupplierSyncOffer; quantity: number }[] = [];
    for (const m of related) {
      const row = rows.find(r => r.supplier === m.supplier);
      if (!row) { hold("MAPPING_IDENTITY_OR_UNITS_UNVERIFIED", m); continue; }
      if (related.filter(x => x.supplier === m.supplier).length !== 1) {
        row.mappingStatus = "collision"; row.quantityStatus = "blocked"; continue;
      }
      // CENTRAL first check. No exact-item or prefix fallback can bypass it.
      if (mappingHold(m.supplier, m.originalSku)) {
        row.mappingStatus = "held"; row.quantityStatus = "blocked"; hold("BLOCKED_SOURCE_HOLD", m); continue;
      }
      if (!SYNC_SUPPLIERS.includes(m.supplier) || !m.id || !integer(m.revision, 1)
        || !m.sellingUnitsVerified || m.identityFingerprint !== v.identityFingerprint) {
        row.mappingStatus = "unverified"; row.quantityStatus = "blocked"; hold("MAPPING_IDENTITY_OR_UNITS_UNVERIFIED", m); continue;
      }
      row.mappingStatus = "approved"; row.originalSku = m.originalSku;
      const key = sourceKey(m.supplier, m.originalSku), sourceRows = offerIndex.get(key) ?? [];
      if (sourceMappings.get(key) !== 1 || sourceRows.length !== 1) {
        if (sourceMappings.get(key) !== 1 || sourceRows.length > 1) {
          row.mappingStatus = "collision"; row.quantityStatus = "blocked";
        }
        hold("MISSING_OR_COLLIDING_SUPPLIER_RECORD", m); continue;
      }
      const o = sourceRows[0], observed = inventoryTimestamp(o.source.supplierUpdatedAt);
      const q = quantityObservation(o.source);
      row.quantity = q.reportedQuantity; row.quantityKind = q.quantityKind;
      row.verifiedCost = verifiedUnitCost(o, p.currency, now, p.maxAgeMinutes[m.supplier]);
      if (row.verifiedCost?.fresh) expires = Math.min(expires,
        Date.parse(row.verifiedCost.observedAt) + p.maxAgeMinutes[m.supplier] * 60000);
      if (Number.isFinite(observed) && observed <= now) row.lastSuccessfulInventoryUpdate = new Date(observed).toISOString();
      if (!Number.isFinite(observed) || observed > now || now - observed > p.maxAgeMinutes[m.supplier] * 60000) {
        row.quantityStatus = Number.isFinite(observed) && observed <= now ? "stale" : "unknown";
        hold("STALE_OR_UNKNOWN_SUPPLIER_QUANTITY", m); continue;
      }
      expires = Math.min(expires, observed + p.maxAgeMinutes[m.supplier] * 60000);
      row.quantityStatus = q.quantityKind === "lower_bound" ? "lower_bound"
        : q.quantityKind === "exact" ? q.reportedQuantity === 0 ? "out_of_stock" : "exact" : "unknown";
      if (q.reportedQuantity === null || q.quantityKind === "unknown" || q.quantityKind === "upper_bound"
        || q.quantityKind === "lower_bound" && p.lowerBounds !== "use_floor") { hold("UNPUBLISHABLE_QUANTITY_OBSERVATION", m); continue; }
      // HobbyTyme On Hand is already individual pieces: NEVER multiply packs.
      row.eligible = !collision;
      row.pricingEligible = row.eligible && q.reportedQuantity > 0 && row.verifiedCost?.fresh === true;
      if (!collision) eligible.push({ m, offer: o, quantity: q.reportedQuantity });
    }
    const visibility = { variantId: v.variantId, sku: v.sku, suppliers: rows };
    supplierVisibility.push(visibility);
    eligible.sort((a, b) => SYNC_SUPPLIERS.indexOf(a.m.supplier) - SYNC_SUPPLIERS.indexOf(b.m.supplier));
    const contributors = eligible.map(({ m, offer }) => ({ supplier: m.supplier, originalSku: m.originalSku,
      mappingId: m.id, mappingRevision: m.revision, sourceFingerprint: digest(offer) }));
    const applicable = new Set(allRelated.map(m => sourceKey(m.supplier, m.originalSku)));
    const relationshipFingerprint = digest({
      mappings: [...allRelated].sort((a, b) => digest(a).localeCompare(digest(b))),
      offers: offers.filter(o => applicable.has(sourceKey(o.source.supplier, o.source.sku))).sort((a, b) => digest(a).localeCompare(digest(b))),
    });
    const base = { variantId: v.variantId, productId: v.productId, inventoryItemId: v.inventoryItemId,
      locationId: p.locationId, identityFingerprint: v.identityFingerprint, sku: v.sku,
      contributors, relationshipFingerprint, committedQuantity: v.committedQuantity };
      if (p.supplierMetafields && input.target !== "matrixify_export") {
      try {
        const meta = prepareSupplierMetafields(v, visibility);
        // Compare values, not different JSON representations of the same object.
        if (meta.before !== meta.after) operations.push({ ...base, field: "supplier_metafields",
          before: meta.before, after: meta.after, metafieldWrites: meta.writes });
      } catch (error) { hold(error instanceof Error ? error.message : "SUPPLIER_METAFIELD_BASELINE_INVALID"); }
    }
    if (!eligible.length || !inventoryReady) continue;
    for (const { m, offer } of eligible) expires = Math.min(expires,
      inventoryTimestamp(offer.source.supplierUpdatedAt) + p.maxAgeMinutes[m.supplier] * 60000);
    const total = eligible.reduce((n, e) => n + BigInt(e.quantity), 0n);
    const net = total - BigInt(p.safetyStock) - BigInt(v.committedQuantity!);
    const quantity = Number(net < 0n ? 0n : net > BigInt(p.maxQuantity) ? BigInt(p.maxQuantity) : net);
    if (quantity !== v.quantity) {
      if (quantity === 0 && eligible.length !== related.length) hold("ZERO_BLOCKED_BY_INCOMPLETE_SUPPLIER_COVERAGE");
      else operations.push({ ...base, field: "inventory", before: v.quantity, after: quantity });
    }
    if (p.pricing.mode === "preserve") continue;
    const priced = eligible.filter(e => e.quantity > 0).map(e => ({
      ...e, cost: rows.find(r => r.supplier === e.m.supplier)!.verifiedCost,
    })).filter(e => e.cost?.fresh);
    priced.sort((a, b) => {
      const diff = BigInt(a.cost!.numeratorCents) * BigInt(b.cost!.denominator) - BigInt(b.cost!.numeratorCents) * BigInt(a.cost!.denominator);
      return diff < 0n ? -1 : diff > 0n ? 1 : 0;
    });
    const lowest = priced[0];
    if (!lowest) { hold("VERIFIED_FRESH_UNIT_COST_REQUIRED"); continue; }
    const c = lowest.cost!, costAt = Date.parse(c.observedAt);
    const cost = BigInt(c.numeratorCents), units = BigInt(c.denominator);
    let before: number;
    try { before = moneyCents(v.price); } catch { hold("INVALID_PRICE_OR_COST", lowest.m); continue; }
    const after = p.pricing.mode === "markup"
      ? ceilDivide(cost * BigInt(10000 + p.pricing.basisPoints), units * 10000n)
      : ceilDivide(cost * 10000n, units * BigInt(10000 - p.pricing.basisPoints));
    if (!Number.isSafeInteger(after) || after > 9999999999) { hold("PRICE_OUT_OF_RANGE", lowest.m); continue; }
    if (after === before) continue;
    if (before === 0 || BigInt(Math.abs(after - before)) * 10000n > BigInt(before) * BigInt(p.maxPriceChangeBasisPoints)) {
      hold("PRICE_CHANGE_LIMIT", lowest.m); continue;
    }
    expires = Math.min(expires, costAt + p.maxAgeMinutes[lowest.m.supplier] * 60000);
    operations.push({ ...base, field: "price", before: priceString(before), after: priceString(after),
      priceBasis: { supplier: lowest.m.supplier, originalSku: lowest.m.originalSku,
        numeratorCents: c.numeratorCents, denominator: c.denominator } });
  }
  const changed = new Set(operations.map(o => o.variantId)).size;
  const zeroed = operations.filter(o => o.field === "inventory" && o.after === 0 && o.before !== 0).length;
  if (changed > p.maxChangedVariants) blockers.push("MAX_CHANGED_VARIANTS_EXCEEDED");
  if (zeroed > p.maxZeroedVariants) blockers.push("MAX_ZEROED_VARIANTS_EXCEEDED");
  if (operations.some(o => o.field === "inventory" && Math.abs(Number(o.after) - Number(o.before)) > p.maxQuantityDelta)) blockers.push("MAX_QUANTITY_DELTA_EXCEEDED");
  const body = { target: input.target ?? "shopify_api", runId: randomUUID(), createdAt: new Date(now).toISOString(),
    expiresAt: new Date(expires).toISOString(),
    shopDomain: p.shopDomain, policyDigest: digest(p), inputDigest: digest({ snapshot: s, mappings, offers }),
    operations, holds, blockers, supplierVisibility, summary: { variants: s.variants.length, changedVariants: changed, zeroedVariants: zeroed,
      inventory: operations.filter(o => o.field === "inventory").length, prices: operations.filter(o => o.field === "price").length,
      supplierMetafields: operations.filter(o => o.field === "supplier_metafields").length },
    publishingEnabled: false as const };
  const deepFreeze = <T>(value: T): T => {
    if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
    return value;
  };
  const plan = deepFreeze({ ...body, digest: digest(body) });
  generatedPlans.add(plan);
  return plan;
}
