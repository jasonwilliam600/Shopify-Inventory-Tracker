/** Pure calculation only: no database, authentication, network or mutation calls. */
import { createHash, randomUUID } from "node:crypto";
import { quantityObservation } from "./supplier-availability";
import { mappingHold } from "./supplier-mapping-policy";
import { SYNC_SUPPLIERS, type SyncPolicy, type SyncSnapshot, type SyncMapping, type SupplierSyncOffer,
  type SyncPlan, type SyncOperation } from "./synchronization-types";
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
export function moneyCents(value: string): number {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value)) return fail("INVALID_MONEY_AMOUNT");
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
const ceilDivide = (n: bigint, d: bigint) => Number((n + d - 1n) / d);
const priceString = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
function validatePolicy(p: SyncPolicy): void {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(p.shopDomain)
    || !/^gid:\/\/shopify\/Location\/[1-9]\d*$/.test(p.locationId) || p.currency !== "USD"
    || !["priority", "maximum_available"].includes(p.selection)
    || p.supplierPriority.length !== 4 || new Set(p.supplierPriority).size !== 4
    || !SYNC_SUPPLIERS.every(s => p.supplierPriority.includes(s) && integer(p.maxAgeMinutes[s], 1))
    || !integer(p.safetyStock) || !integer(p.maxQuantity, 1)
    || !integer(p.maxChangedVariants, 1) || !integer(p.maxZeroedVariants)
    || !integer(p.maxQuantityDelta) || !integer(p.maxPriceChangeBasisPoints)
    || !integer(p.maxPlanAgeSeconds, 1) || p.maxPlanAgeSeconds > 300
    || !["hold", "use_floor"].includes(p.lowerBounds)) fail("INVALID_SYNC_POLICY");
  if (p.pricing.mode !== "preserve" && (!["margin", "markup"].includes(p.pricing.mode)
    || !integer(p.pricing.basisPoints) || p.pricing.basisPoints > (p.pricing.mode === "margin" ? 9999 : 100000))) fail("INVALID_PRICING_POLICY");
}
export function buildSyncPlan(input: { policy: SyncPolicy; snapshot: SyncSnapshot;
  mappings: readonly SyncMapping[]; offers: readonly SupplierSyncOffer[]; nowMs?: number }): SyncPlan {
  const { policy: p, snapshot: s, mappings, offers } = input, now = input.nowMs ?? Date.now();
  validatePolicy(p);
  if (!Number.isFinite(now)) fail("INVALID_SYNC_TIME");
  const blockers: string[] = [], holds: SyncPlan["holds"][number][] = [], operations: SyncOperation[] = [];
  const verification = Date.parse(s.verifiedAt);
  if (!s.complete || s.shopDomain !== p.shopDomain || s.currency !== p.currency
    || !Number.isFinite(verification) || verification > now || now - verification > p.maxPlanAgeSeconds * 1000) blockers.push("CURRENT_COMPLETE_SHOP_SNAPSHOT_REQUIRED");
  const required = ["read_products", "read_inventory", "read_locations", "write_inventory"];
  if (p.pricing.mode !== "preserve") required.push("write_products");
  if (required.some(scope => !s.scopes.includes(scope))) blockers.push("SHOPIFY_SCOPES_MISSING");
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
    if (!v.active) { hold("INACTIVE_PRODUCT"); continue; }
    if (!v.tracked || !v.locationActive || v.locationId !== p.locationId || !integer(v.quantity)) { hold("INVENTORY_LOCATION_OR_TRACKING_UNVERIFIED"); continue; }
    if (v.committedQuantity === null || !integer(v.committedQuantity)) { hold("SHOPIFY_COMMITTED_QUANTITY_REQUIRED"); continue; }
    const related = mappings.filter(m => m.variantId === v.variantId && m.state === "approved");
    if (!related.length) { hold("APPROVED_MAPPING_REQUIRED"); continue; }
    if (new Set(related.map(m => m.supplier)).size !== related.length) { hold("SAME_SUPPLIER_COLLISION"); continue; }
    const eligible: { m: SyncMapping; offer: SupplierSyncOffer; quantity: number }[] = [];
    for (const m of related) {
      // CENTRAL first check. No exact-item or prefix fallback can bypass it.
      if (mappingHold(m.supplier, m.originalSku)) { hold("BLOCKED_SOURCE_HOLD", m); continue; }
      if (!SYNC_SUPPLIERS.includes(m.supplier) || !m.id || !integer(m.revision, 1)
        || !m.sellingUnitsVerified || m.identityFingerprint !== v.identityFingerprint) { hold("MAPPING_IDENTITY_OR_UNITS_UNVERIFIED", m); continue; }
      const key = sourceKey(m.supplier, m.originalSku), rows = offerIndex.get(key) ?? [];
      if (sourceMappings.get(key) !== 1 || rows.length !== 1) { hold("MISSING_OR_COLLIDING_SUPPLIER_RECORD", m); continue; }
      const o = rows[0], observed = Date.parse(String(o.source.supplierUpdatedAt ?? ""));
      if (!Number.isFinite(observed) || observed > now || now - observed > p.maxAgeMinutes[m.supplier] * 60000) { hold("STALE_OR_UNKNOWN_SUPPLIER_QUANTITY", m); continue; }
      const q = quantityObservation(o.source);
      if (q.reportedQuantity === null || q.quantityKind === "unknown" || q.quantityKind === "upper_bound"
        || q.quantityKind === "lower_bound" && p.lowerBounds !== "use_floor") { hold("UNPUBLISHABLE_QUANTITY_OBSERVATION", m); continue; }
      // HobbyTyme On Hand is already individual pieces: NEVER multiply packs.
      eligible.push({ m, offer: o, quantity: Math.min(p.maxQuantity, Math.max(0, q.reportedQuantity - p.safetyStock - v.committedQuantity)) });
    }
    eligible.sort((a, b) => p.selection === "maximum_available" && a.quantity !== b.quantity ? b.quantity - a.quantity
      : p.supplierPriority.indexOf(a.m.supplier) - p.supplierPriority.indexOf(b.m.supplier));
    const selected = eligible.find(x => x.quantity > 0) ?? eligible[0];
    if (!selected) continue;
    const { m, offer, quantity } = selected;
    expires = Math.min(expires, Date.parse(String(offer.source.supplierUpdatedAt)) + p.maxAgeMinutes[m.supplier] * 60000);
    const base = { variantId: v.variantId, productId: v.productId, inventoryItemId: v.inventoryItemId,
      locationId: p.locationId, identityFingerprint: v.identityFingerprint, sku: v.sku,
      supplier: m.supplier, originalSku: m.originalSku, mappingId: m.id, mappingRevision: m.revision,
      sourceFingerprint: digest(offer), committedQuantity: v.committedQuantity };
    if (quantity !== v.quantity) {
      if (quantity === 0 && eligible.length !== related.length) hold("ZERO_BLOCKED_BY_INCOMPLETE_SUPPLIER_COVERAGE");
      else operations.push({ ...base, field: "inventory", before: v.quantity, after: quantity });
    }
    if (p.pricing.mode === "preserve") continue;
    const c = offer.cost, costAt = c ? Date.parse(c.observedAt) : NaN;
    if (!c || !c.basisVerified || c.currency !== p.currency || !["piece", "pack"].includes(c.basis)
      || c.basis === "pack" && (!integer(c.packSize ?? 0, 1))
      || !Number.isFinite(costAt) || costAt > now || now - costAt > p.maxAgeMinutes[m.supplier] * 60000) { hold("VERIFIED_FRESH_UNIT_COST_REQUIRED", m); continue; }
    let cost: number, before: number;
    try { cost = moneyCents(c.amount); before = moneyCents(v.price); } catch { hold("INVALID_PRICE_OR_COST", m); continue; }
    if (cost <= 0) { hold("ZERO_OR_UNKNOWN_COST", m); continue; }
    if (c.basis === "pack") cost = ceilDivide(BigInt(cost), BigInt(c.packSize!));
    const after = p.pricing.mode === "markup"
      ? ceilDivide(BigInt(cost) * BigInt(10000 + p.pricing.basisPoints), 10000n)
      : ceilDivide(BigInt(cost) * 10000n, BigInt(10000 - p.pricing.basisPoints));
    if (!Number.isSafeInteger(after) || after > 9999999999) { hold("PRICE_OUT_OF_RANGE", m); continue; }
    if (after === before) continue;
    if (before === 0 || BigInt(Math.abs(after - before)) * 10000n > BigInt(before) * BigInt(p.maxPriceChangeBasisPoints)) {
      hold("PRICE_CHANGE_LIMIT", m); continue;
    }
    expires = Math.min(expires, costAt + p.maxAgeMinutes[m.supplier] * 60000);
    operations.push({ ...base, field: "price", before: priceString(before), after: priceString(after) });
  }
  const changed = new Set(operations.map(o => o.variantId)).size;
  const zeroed = operations.filter(o => o.field === "inventory" && o.after === 0 && o.before !== 0).length;
  if (changed > p.maxChangedVariants) blockers.push("MAX_CHANGED_VARIANTS_EXCEEDED");
  if (zeroed > p.maxZeroedVariants) blockers.push("MAX_ZEROED_VARIANTS_EXCEEDED");
  if (operations.some(o => o.field === "inventory" && Math.abs(Number(o.after) - Number(o.before)) > p.maxQuantityDelta)) blockers.push("MAX_QUANTITY_DELTA_EXCEEDED");
  const body = { runId: randomUUID(), createdAt: new Date(now).toISOString(),
    expiresAt: new Date(expires).toISOString(),
    shopDomain: p.shopDomain, policyDigest: digest(p), inputDigest: digest({ snapshot: s, mappings, offers }),
    operations, holds, blockers, summary: { variants: s.variants.length, changedVariants: changed, zeroedVariants: zeroed,
      inventory: operations.filter(o => o.field === "inventory").length, prices: operations.filter(o => o.field === "price").length },
    publishingEnabled: false as const };
  const plan = Object.freeze({ ...body, operations: Object.freeze(operations.map(o => Object.freeze(o))),
    holds: Object.freeze(holds.map(h => Object.freeze(h))), summary: Object.freeze(body.summary),
    blockers: Object.freeze(blockers), digest: digest(body) });
  generatedPlans.add(plan);
  return plan;
}
