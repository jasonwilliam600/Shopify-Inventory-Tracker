import type { DistributorStock, InventoryGroup } from "@workspace/api-zod";

/** A source offer, never a verified Shopify variant or location. */
export interface GroupOffer {
  groupKey: string;
  mappedStoreSku: string | null;
  sku: string;
  supplier: string;
  productName: string;
  variant: string;
  supplierStock: number | null;
  supplierStatus: string;
  supplierUpdatedAt: string | Date | null;
  supplierPrice: number | null;
  stockText: string;
  manufacturerName?: string | null;
}

export const INVENTORY_PUBLISHING_STATE = {
  shopifyConnected: false,
  publishingEnabled: false,
  blockingReason: "Shopify is disconnected. Distributor totals have not been published to your store.",
  prerequisites: [
    "Connect and verify your existing Shopify store.",
    "Match each candidate to a unique Shopify variant and confirm selling units.",
    "Assign each distributor to an approved Shopify location eligible for online fulfillment.",
    "Verify inventory permissions and order reservations before enabling stock publishing.",
  ],
} as const;

function countedQuantity(offer: GroupOffer): number | null {
  if (offer.supplierStatus === "unavailable") return 0;
  if (!["available", "low"].includes(offer.supplierStatus)) return null;
  const quantity = offer.supplierStock;
  return quantity !== null && Number.isSafeInteger(quantity) && quantity >= 0 ? quantity : null;
}

export function groupDistributorOffers(offers: GroupOffer[], suppliers: string[]): InventoryGroup[] {
  const grouped = new Map<string, GroupOffer[]>();
  for (const offer of offers) {
    const rows = grouped.get(offer.groupKey) ?? [];
    rows.push(offer);
    grouped.set(offer.groupKey, rows);
  }
  return [...grouped.entries()].map(([groupKey, rows]) => {
    const supplierCounts = new Map<string, number>();
    for (const row of rows) supplierCounts.set(row.supplier, (supplierCounts.get(row.supplier) ?? 0) + 1);
    const distributors: DistributorStock[] = rows.map((row) => {
      const mappingConflict = (supplierCounts.get(row.supplier) ?? 0) > 1;
      return {
        supplier: row.supplier,
        sourceSku: row.sku,
        manufacturerName: row.manufacturerName ?? null,
        locationName: row.supplier === "Heartland Hobby Wholesale" ? "Heartland" : row.supplier,
        shopifyLocationId: null,
        reportedQuantity: row.supplierStock,
        countedQuantity: mappingConflict ? null : countedQuantity(row),
        supplierStatus: row.supplierStatus,
        supplierUpdatedAt: row.supplierUpdatedAt ? new Date(row.supplierUpdatedAt) : null,
        wholesalePrice: row.supplierPrice,
        mappingConflict,
        boundedQuantity: /\d\s*\+/.test(row.stockText),
      };
    });
    const conflict = distributors.some((offer) => offer.mappingConflict);
    const incomplete = distributors.some((offer) => offer.countedQuantity === null);
    const knownSubtotal = distributors.reduce((total, offer) => total + (offer.countedQuantity ?? 0), 0);
    const total = incomplete ? null : knownSubtotal;
    const mappedStoreSku = rows[0].mappedStoreSku;
    return {
      groupKey,
      sku: mappedStoreSku ?? rows[0].sku,
      mappedStoreSku,
      productName: rows[0].productName,
      variant: rows[0].variant,
      mappingState: conflict ? "conflict" : mappedStoreSku ? "candidate" : "unmapped",
      status: conflict || incomplete || !mappedStoreSku ? "review" : total === 0 ? "unavailable" : "available",
      distributorTotal: total,
      knownSubtotal,
      shopifySellableStock: null,
      boundedQuantity: distributors.some((offer) => offer.boundedQuantity && offer.countedQuantity !== null),
      distributors,
      missingSuppliers: suppliers.filter((supplier) => !supplierCounts.has(supplier)),
    };
  });
}