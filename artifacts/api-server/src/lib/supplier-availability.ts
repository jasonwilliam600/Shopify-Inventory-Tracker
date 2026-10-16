import type { SupplierAvailabilityOffer, SupplierAvailabilityVariant } from "@workspace/api-zod";
import { APPROVED_CATALOG_MAPPINGS, mapSupplierSkuToStore } from "./sku-mapping";
import { mappingHold } from "./supplier-mapping-policy";

export const AVAILABILITY_SUPPLIERS = [
  "Heartland Hobby Wholesale", "HobbyTyme", "Walthers", "MMD/Squadron",
] as const;
// Display warning windows only. These do not authorize a publishing policy.
export const DISPLAY_FRESHNESS_MINUTES: Readonly<Record<string, number>> = {
  "Heartland Hobby Wholesale": 90, HobbyTyme: 1440, Walthers: 180, "MMD/Squadron": 180,
};
export type CatalogVariant = Omit<SupplierAvailabilityVariant, "suppliers">;
export interface AvailabilitySource {
  supplier: string;
  sku: string;
  supplierStock: number | null;
  supplierStatus: string;
  supplierUpdatedAt: string | Date | null;
  raw: Record<string, unknown>;
}
type Observation = Pick<SupplierAvailabilityOffer, "reportedQuantity" | "quantityKind" | "quantityText" | "availability" | "stockReason">;
const unknown = (reason: string): Observation => ({
  reportedQuantity: null, quantityKind: "unknown", quantityText: "Unknown",
  availability: "unknown", stockReason: reason,
});

/** Do not promote legacy coerced zeroes, feed bounds, or contradictory statuses. */
export function quantityObservation(source: AvailabilitySource): Observation {
  const stored = source.supplierStock;
  if (stored === null || !Number.isSafeInteger(stored) || stored < 0) return unknown("Missing or invalid stored quantity.");
  if (!["available", "low", "unavailable"].includes(source.supplierStatus)) return unknown("Supplier availability status is unknown.");
  const key = source.supplier === "HobbyTyme" ? "On Hand"
    : source.supplier === "Heartland Hobby Wholesale" ? "ZCMQOH"
    : source.supplier === "Walthers" ? "quantityavailable" : "Stock Level";
  // The authenticated MMD catalog is the quantity source when present; its
  // original stock-export observation can legitimately differ.
  const dealerSupplement = source.supplier === "MMD/Squadron"
    && source.raw.quantitySource === "Authenticated MMD dealer table";
  const rawValue = dealerSupplement ? source.raw.dealerStock : source.raw[key];
  let text = typeof rawValue === "number" ? String(rawValue)
    : typeof rawValue === "string" ? rawValue.trim() : "";
  if (!text) return unknown("Original feed quantity is missing; a stored zero is not confirmation of out-of-stock.");
  if (/^\d{1,3}(?:,\d{3})+(?:\.0+)?$/.test(text)) text = text.replaceAll(",", "");

  const lower = text.match(/^(?:(>=|≥|>)\s*(\d+)|(\d+)\s*\+)$/);
  const upper = text.match(/^(<=|≤|<)\s*(\d+)$/);
  let value: number;
  let kind: Observation["quantityKind"] = "exact";
  if (lower) {
    value = Number(lower[2] ?? lower[3]) + (lower[1] === ">" ? 1 : 0);
    kind = "lower_bound";
  } else if (upper) {
    value = Number(upper[2]);
    kind = "upper_bound";
  } else if (/^\d+(?:\.0+)?$/.test(text)) {
    value = Number(text);
  } else {
    return unknown("Original feed quantity is not an exact count or a recognized bound.");
  }
  if (!Number.isSafeInteger(value) || value < 0) return unknown("Original feed quantity exceeds the safe count range.");
  if (kind === "exact" && value !== stored) return unknown("Stored quantity conflicts with the preserved feed observation.");
  if (kind !== "upper_bound" && ((value > 0 && source.supplierStatus === "unavailable")
    || (value === 0 && kind === "exact" && source.supplierStatus !== "unavailable"))) {
    return unknown("Feed status and quantity conflict; out-of-stock cannot be inferred.");
  }
  return {
    reportedQuantity: value, quantityKind: kind, quantityText: text,
    availability: kind === "upper_bound" || (kind === "lower_bound" && value === 0) ? "unknown"
      : value > 0 ? "available" : "out_of_stock",
    stockReason: source.supplier === "HobbyTyme"
      ? "On Hand is individual pieces; ordering pack size is not applied."
      : "Reported supplier units; retail selling-unit identity still requires review.",
  };
}

export function sourceCandidates(source: AvailabilitySource, knownSkus: ReadonlySet<string>) {
  const sku = source.sku.trim();
  const exact = APPROVED_CATALOG_MAPPINGS[source.supplier];
  const mapped = mapSupplierSkuToStore(sku, source.supplier);
  // Explicit item entries, including null blocks, cannot be bypassed by a
  // source SKU that happens to resemble a second store SKU.
  const candidates = exact && Object.hasOwn(exact, sku)
    ? mapped ? [{ sku: mapped, method: "exact_identifier" as const }] : []
    : [
      ...(mapped ? [{ sku: mapped, method: "prefix" as const }] : []),
      ...(mapped !== sku ? [{ sku, method: "exact_sku" as const }] : []),
    ];
  return candidates.filter(candidate => knownSkus.has(candidate.sku));
}

/** Pure evaluator shared with future callers; contains no writes or Shopify I/O. */
export function evaluateSupplierAvailability(
  variants: readonly CatalogVariant[],
  sources: readonly AvailabilitySource[],
  knownSkus: ReadonlySet<string>,
  now = new Date(),
): SupplierAvailabilityVariant[] {
  const byTarget = new Map<string, { source: AvailabilitySource; method: SupplierAvailabilityOffer["matchMethod"]; ambiguous: boolean }[]>();
  for (const source of sources) {
    if (!(AVAILABILITY_SUPPLIERS as readonly string[]).includes(source.supplier)) continue;
    const candidates = sourceCandidates(source, knownSkus);
    for (const candidate of candidates) {
      const offers = byTarget.get(candidate.sku) ?? [];
      offers.push({ source, method: candidate.method, ambiguous: candidates.length > 1 });
      byTarget.set(candidate.sku, offers);
    }
  }
  return variants.map(variant => ({
    ...variant,
    suppliers: AVAILABILITY_SUPPLIERS.map(supplier => {
      const entries = variant.sku ? (byTarget.get(variant.sku) ?? []).filter(row => row.source.supplier === supplier) : [];
      return {
        supplier,
        offers: entries.map(({ source, method, ambiguous }): SupplierAvailabilityOffer => {
          const hold = mappingHold(supplier, source.sku);
          const collision = entries.length > 1;
          const mappingStatus = hold?.status ?? (collision ? "collision"
            : variant.skuStatus === "duplicate" || ambiguous ? "held" : "candidate");
          const mappingReason = [
            hold?.reason,
            collision ? "Multiple source SKUs from this supplier map to this SKU; no quantities are combined." : null,
            variant.skuStatus === "duplicate" ? "Duplicate Shopify SKU in historical export; variant identity is ambiguous." : null,
            ambiguous ? "Source has multiple plausible catalog identifiers; product identity needs review." : null,
            "Historical catalog only. Current Shopify variant identity and selling units are not verified.",
          ].filter(Boolean).join(" ");
          const date = source.supplierUpdatedAt ? new Date(source.supplierUpdatedAt) : null;
          const validDate = date !== null && Number.isFinite(date.getTime());
          const age = validDate ? now.getTime() - date.getTime() : null;
          const limit = DISPLAY_FRESHNESS_MINUTES[supplier];
          return {
            sourceSku: source.sku, mappingStatus, mappingReason, matchMethod: method,
            ...quantityObservation(source),
            freshness: age === null || age < -300_000 ? "unknown" : age > limit * 60_000 ? "stale" : "fresh",
            lastFeedImport: validDate ? date : null,
            freshnessLimitMinutes: limit, trusted: false, publishable: false,
          };
        }),
      };
    }),
  }));
}
