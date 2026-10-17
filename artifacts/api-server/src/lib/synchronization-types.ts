import type { AvailabilitySource } from "./supplier-availability";

export const SYNC_SUPPLIERS = ["Heartland Hobby Wholesale", "HobbyTyme", "Walthers", "MMD/Squadron"] as const;
export type SyncSupplier = typeof SYNC_SUPPLIERS[number];
export interface SyncPolicy {
  shopDomain: string;
  locationId: string;
  currency: "USD";
  selection: "combine";
  supplierMetafields: boolean;
  maxAgeMinutes: Record<SyncSupplier, number>;
  safetyStock: number;
  maxQuantity: number;
  lowerBounds: "hold" | "use_floor";
  pricing: { mode: "preserve" } | { mode: "markup" | "margin"; basisPoints: number };
  maxChangedVariants: number;
  maxZeroedVariants: number;
  maxQuantityDelta: number;
  maxPriceChangeBasisPoints: number;
  maxPlanAgeSeconds: number;
}
export interface VerifiedSyncVariant {
  variantId: string; productId: string; inventoryItemId: string;
  sku: string; identityFingerprint: string; active: boolean;
  tracked: boolean; locationId: string; locationActive: boolean;
  quantity: number; committedQuantity: number | null; price: string;
  /** Must include all five managed keys, explicitly null when absent. */
  supplierMetafields?: Record<string, { value: string; compareDigest: string } | null>;
}
export interface SyncSnapshot {
  shopDomain: string; currency: string; scopes: string[];
  verifiedAt: string; complete: boolean; variants: VerifiedSyncVariant[];
}
export interface SyncMapping {
  id: string; revision: number; state: "approved" | "candidate" | "rejected";
  supplier: SyncSupplier; originalSku: string; variantId: string;
  identityFingerprint: string; sellingUnitsVerified: boolean;
}
export interface SupplierSyncOffer {
  source: AvailabilitySource;
  cost: null | { amount: string; currency: string; basis: "piece" | "pack" | "unknown" | "msrp";
    basisVerified: boolean; packSize: number | null; observedAt: string };
}
export interface SyncOperation {
  variantId: string; productId: string; inventoryItemId: string; locationId: string;
  identityFingerprint: string; sku: string;
  relationshipFingerprint: string;
  /** Every eligible source; aggregate stock and minimum cost depend on all of them. */
  contributors: readonly SyncContributor[];
  committedQuantity: number | null;
  field: "inventory" | "price" | "supplier_metafields"; before: number | string; after: number | string;
  metafieldWrites?: readonly SupplierMetafieldWrite[];
  priceBasis?: { supplier: SyncSupplier; originalSku: string; numeratorCents: string; denominator: string };
}
export interface SyncContributor {
  supplier: SyncSupplier; originalSku: string; mappingId: string; mappingRevision: number; sourceFingerprint: string;
}
export interface SupplierMetafieldWrite {
  ownerId: string; namespace: string; key: string; type: string; value: string; compareDigest: string | null;
}
export interface SupplierVisibilityRow {
  supplier: SyncSupplier; originalSku: string | null;
  mappingStatus: "approved" | "held" | "collision" | "unmatched" | "unverified" | "blocked";
  quantity: number | null;
  quantityKind: "exact" | "lower_bound" | "upper_bound" | "unknown";
  quantityStatus: "exact" | "lower_bound" | "unknown" | "stale" | "out_of_stock" | "blocked";
  eligible: boolean; pricingEligible: boolean; lastSuccessfulInventoryUpdate: string | null;
  verifiedCost: null | { amount: string; currency: "USD"; basis: "piece" | "pack"; packSize: number | null;
    unitCostDisplay: string; numeratorCents: string; denominator: string; observedAt: string; fresh: boolean };
}
export interface VariantSupplierVisibility {
  variantId: string; sku: string; suppliers: readonly SupplierVisibilityRow[];
}
export interface SyncPlan {
  readonly target?: "shopify_api" | "matrixify_export";
  runId: string; createdAt: string; expiresAt: string; shopDomain: string;
  digest: string; policyDigest: string; inputDigest: string;
  operations: readonly SyncOperation[];
  supplierVisibility: readonly VariantSupplierVisibility[];
  holds: readonly { variantId: string; code: string; supplier?: string; originalSku?: string }[];
  blockers: readonly string[];
  summary: { variants: number; changedVariants: number; zeroedVariants: number; inventory: number; prices: number; supplierMetafields: number };
  publishingEnabled: false;
}
