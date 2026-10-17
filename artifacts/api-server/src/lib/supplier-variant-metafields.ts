/** Pure Shopify payloads. NO credentials, transport, network or installation.
 * App-owned, staff-readable only. Cost information is NEVER storefront-visible. */
import type { SupplierMetafieldWrite, VariantSupplierVisibility, VerifiedSyncVariant } from "./synchronization-types";
import { SYNC_SUPPLIERS } from "./synchronization-types";
export const SUPPLIER_METAFIELD_NAMESPACE = "$app:tsh_inventory_sync";
export const SUPPLIER_METAFIELD_KEYS = ["supplier_availability", "heartland", "hobbytyme", "walthers", "mmd_squadron"] as const;
export const SUPPLIER_METAFIELD_DEFINITIONS = Object.freeze(SUPPLIER_METAFIELD_KEYS.map((key, i) => Object.freeze({
  name: i === 0 ? "TSH supplier availability data" : `TSH ${["Heartland", "HobbyTyme", "Walthers", "MMD/Squadron"][i - 1]} availability`,
  namespace: SUPPLIER_METAFIELD_NAMESPACE, key, ownerType: "PRODUCTVARIANT",
  type: i === 0 ? "json" : "multi_line_text_field",
  description: "Staff-only supplier data. Quantities are individual pieces, not ordering packs. Not physical store stock.",
  access: Object.freeze({ admin: "MERCHANT_READ", storefront: "NONE", customerAccount: "NONE" }),
})));
export const SUPPLIER_DEFINITION_CREATE = `mutation TSHSupplierDefinition($definition: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $definition) {
    createdDefinition { id namespace key ownerType type { name } access { admin storefront customerAccount } }
    userErrors { field message code }
  }
}`;
export const SUPPLIER_DEFINITION_PIN = `mutation TSHSupplierPin($definitionId: ID!) {
  metafieldDefinitionPin(definitionId: $definitionId) { pinnedDefinition { id } userErrors { field message code } }
}`;
export const SUPPLIER_DEFINITIONS_READ = `query TSHSupplierDefinitions {
  metafieldDefinitions(first: 10, ownerType: PRODUCTVARIANT, namespace: "$app:tsh_inventory_sync") {
    nodes { id namespace key ownerType type { name } access { admin storefront customerAccount } }
    pageInfo { hasNextPage }
  }
}`;
export const SUPPLIER_BASELINE_READ = `query TSHSupplierBaseline($variantId: ID!) {
  productVariant(id: $variantId) {
    id
    ${SUPPLIER_METAFIELD_KEYS.map((key, i) => `field${i}: metafield(namespace: "$app:tsh_inventory_sync", key: "${key}") {
      namespace key type value compareDigest
    }`).join("\n")}
  }
}`;
export const SUPPLIER_METAFIELDS_SET = `mutation TSHSupplierVisibility($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { owner { ... on ProductVariant { id } } namespace key type value compareDigest }
    userErrors { field message code }
  }
}`;
export function supplierVisibilityValues(visibility: VariantSupplierVisibility): Record<string, string> {
  if (visibility.suppliers.length !== 4 || SYNC_SUPPLIERS.some((s, i) => visibility.suppliers[i].supplier !== s)) throw new Error("SUPPLIER_VISIBILITY_REQUIRES_FOUR_ROWS");
  const values: Record<string, string> = {
    supplier_availability: JSON.stringify({ schemaVersion: 1, units: "individual_pieces", ...visibility }),
  };
  visibility.suppliers.forEach((r, index) => {
    const c = r.verifiedCost;
    values[SUPPLIER_METAFIELD_KEYS[index + 1]] = [
      r.supplier,
      `Mapping: ${r.mappingStatus}`,
      `Supplier SKU: ${r.originalSku === null ? "Not trusted / unavailable" : JSON.stringify(r.originalSku)}`,
      `Quantity: ${r.quantity === null ? "Unknown" : r.quantityKind === "lower_bound" ? `At least ${r.quantity}` : r.quantityKind === "upper_bound" ? `At most ${r.quantity}` : r.quantity} individual pieces (${r.quantityStatus})`,
      `Eligible source for combined stock: ${r.eligible ? "Yes" : "No"}`,
      `Eligible verified pricing basis: ${r.pricingEligible ? "Yes" : "No"}`,
      c ? `Verified cost: USD ${c.unitCostDisplay} / piece (${c.fresh ? "fresh" : "stale; not eligible for pricing"})`
        : "Verified cost: Unknown / unverified",
      ...(c?.basis === "pack" ? [`Ordering cost: USD ${c.amount} per ${c.packSize}-piece pack; stock remains individual pieces`] : []),
      ...(c?.basis === "pack" ? ["Unit-cost display rounded up to 6 decimals; pricing uses exact pack-cost division"] : []),
      ...(c ? [`Cost verified/observed: ${c.observedAt}`] : []),
      `Last successful inventory update: ${r.lastSuccessfulInventoryUpdate ?? "Unknown"}`,
    ].join("\n");
  });
  return values;
}
export interface SupplierDefinitionObservation {
  namespace: string; key: string; ownerType: string; type: { name: string };
  access: { admin: string; storefront: string; customerAccount: string };
}
/** Caller must bind namespace to the authenticated existing installation, not
 * another app. Unexpected/public/missing/duplicate definitions are NOT repaired. */
export function verifySupplierDefinitionPrivacy(definitions: readonly SupplierDefinitionObservation[], namespace: string): void {
  if (!/^app--[1-9]\d*--tsh_inventory_sync$/.test(namespace) || definitions.length !== 5
    || SUPPLIER_METAFIELD_DEFINITIONS.some(expected => definitions.filter(d =>
      d.namespace === namespace && d.key === expected.key && d.ownerType === expected.ownerType
      && d.type.name === expected.type && d.access.admin === "MERCHANT_READ"
      && d.access.storefront === "NONE" && d.access.customerAccount === "NONE").length !== 1)) {
    throw new Error("SUPPLIER_METAFIELD_PRIVACY_NOT_VERIFIED");
  }
}
/** Pure response check for a future approved transport; no API execution. */
export function validateSupplierMetafieldResponse(payload: unknown, writes: readonly SupplierMetafieldWrite[], namespace: string): void {
  const response = payload as { errors?: unknown[]; data?: { metafieldsSet?: {
    userErrors?: unknown[]; metafields?: { owner: { id: string }; namespace: string; key: string; type: string; value: string; compareDigest: string }[];
  } } };
  const result = response?.data?.metafieldsSet;
  if (!/^app--[1-9]\d*--tsh_inventory_sync$/.test(namespace) || response?.errors?.length
    || !result || !Array.isArray(result.userErrors) || result.userErrors.length
    || !Array.isArray(result.metafields) || result.metafields.length !== writes.length
    || writes.length !== 5 || writes.some(w => result.metafields!.filter(m =>
      m?.owner?.id === w.ownerId && m.namespace === namespace && m.key === w.key && m.type === w.type
      && m.value === w.value && /^[a-f0-9]{64}$/.test(m.compareDigest)).length !== 1)) {
    throw new Error("SUPPLIER_METAFIELD_WRITE_NOT_CONFIRMED");
  }
}
/** Explicit absence (null) is different from a missing/unqueried baseline key. */
export function prepareSupplierMetafields(v: VerifiedSyncVariant, visibility: VariantSupplierVisibility): {
  before: string; after: string; writes: SupplierMetafieldWrite[];
} {
  if (!v.supplierMetafields || visibility.variantId !== v.variantId
    || SUPPLIER_METAFIELD_KEYS.some(k => !Object.hasOwn(v.supplierMetafields!, k))) throw new Error("SUPPLIER_METAFIELD_BASELINE_REQUIRED");
  const values = supplierVisibilityValues(visibility), before: Record<string, string | null> = {}, after: Record<string, string> = {};
  const writes = SUPPLIER_METAFIELD_KEYS.map((key, i) => {
    const prior = v.supplierMetafields![key];
    if (prior !== null && (!prior || typeof prior.value !== "string" || !/^[a-f0-9]{64}$/.test(prior.compareDigest))) {
      throw new Error("SUPPLIER_METAFIELD_BASELINE_INVALID");
    }
    before[key] = prior?.value ?? null; after[key] = values[key];
    return { ownerId: v.variantId, namespace: SUPPLIER_METAFIELD_NAMESPACE, key,
      type: i === 0 ? "json" : "multi_line_text_field", value: values[key], compareDigest: prior?.compareDigest ?? null };
  });
  return { before: JSON.stringify(before), after: JSON.stringify(after), writes };
}
