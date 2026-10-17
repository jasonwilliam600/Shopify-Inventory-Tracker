import type { AvailabilitySource } from "./supplier-availability";

export const SYNC_SUPPLIERS = ["Heartland Hobby Wholesale", "HobbyTyme", "Walthers", "MMD/Squadron"] as const;
export type SyncSupplier = typeof SYNC_SUPPLIERS[number];
export interface SyncPolicy {
  shopDomain: string;
  locationId: string;
  currency: "USD";
  supplierPriority: SyncSupplier[];
  selection: "priority" | "maximum_available";
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
  identityFingerprint: string; sku: string; supplier: SyncSupplier; originalSku: string;
  mappingId: string; mappingRevision: number;
  sourceFingerprint: string;
  committedQuantity: number;
  field: "inventory" | "price"; before: number | string; after: number | string;
}
export interface SyncPlan {
  runId: string; createdAt: string; expiresAt: string; shopDomain: string;
  digest: string; policyDigest: string; inputDigest: string;
  operations: readonly SyncOperation[];
  holds: readonly { variantId: string; code: string; supplier?: string; originalSku?: string }[];
  blockers: readonly string[];
  summary: { variants: number; changedVariants: number; zeroedVariants: number; inventory: number; prices: number };
  publishingEnabled: false;
}
