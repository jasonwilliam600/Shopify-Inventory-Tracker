export interface WalthersItem {
  internalid: number;
  itemid: string;
  quantityavailable?: number | null;
  onlinecustomerprice?: number | null;
  pricelevel1?: number | null;
  storedisplayname2?: string;
  storedescription?: string;
  custitem_walthers_item_brand?: string;
}

/** Quantities are supplier SKU units, not assumed pieces or Shopify units. */
export function normalizeWalthersItem(item: WalthersItem) {
  if (!Number.isSafeInteger(item.internalid) || !item.itemid?.trim()) {
    throw new Error("Walthers returned an invalid product identifier; previous inventory preserved");
  }
  const quantity = item.quantityavailable;
  if (quantity != null && !Number.isFinite(quantity)) {
    throw new Error("Walthers returned an invalid inventory quantity; previous inventory preserved");
  }
  for (const value of [item.onlinecustomerprice, item.pricelevel1]) {
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      throw new Error("Walthers returned an invalid price; previous inventory preserved");
    }
  }
  const needsUnitReview = quantity != null && (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 2_147_483_647);
  const stock = needsUnitReview ? null : quantity ?? null;
  return {
    sku: item.itemid.trim(),
    productName: [item.storedisplayname2, item.storedescription].filter(Boolean).join(" — ") || item.itemid.trim(),
    manufacturerName: item.custitem_walthers_item_brand?.trim() || null,
    supplierStock: stock,
    supplierPrice: item.onlinecustomerprice ?? null,
    price: item.pricelevel1 ?? 0,
    supplierStatus: stock === null ? "unknown" : stock === 0 ? "unavailable" : stock <= 5 ? "low" : "available",
    quantityNote: needsUnitReview ? `Walthers reports ${quantity} available units. Quantity is excluded from totals pending review; it has not been rounded or converted.` : null,
  };
}