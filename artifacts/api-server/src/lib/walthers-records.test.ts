import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeWalthersItem, type WalthersItem } from "./walthers-records";

const item: WalthersItem = {
  internalid: 123, itemid: "373-95572", quantityavailable: 6,
  onlinecustomerprice: 7.88, pricelevel1: 13.14,
  storedisplayname2: "Assorted Potted Flower Plants",
  storedescription: "Set #4 pkg(6)", custitem_walthers_item_brand: "JTT Miniature Tree",
};

test("keeps the original Walthers SKU, reported units, dealer price, and manufacturer", () => {
  const result = normalizeWalthersItem(item);
  assert.equal(result.sku, "373-95572");
  assert.equal(result.supplierStock, 6);
  assert.equal(result.supplierPrice, 7.88);
  assert.equal(result.price, 13.14);
  assert.equal(result.manufacturerName, "JTT Miniature Tree");
  assert.equal(result.supplierStatus, "available");
  // A description of pkg(6) does not justify multiplying quantity by six.
});

test("missing quantity stays unknown, never zero", () => {
  const result = normalizeWalthersItem({ ...item, quantityavailable: undefined });
  assert.equal(result.supplierStock, null);
  assert.equal(result.supplierStatus, "unknown");
});

test("missing dealer price is never replaced by MSRP", () => {
  const result = normalizeWalthersItem({ ...item, onlinecustomerprice: null });
  assert.equal(result.supplierPrice, null);
  assert.equal(result.price, 13.14);
});

test("zero quantity is unavailable and small positive quantities are low stock", () => {
  assert.equal(normalizeWalthersItem({ ...item, quantityavailable: 0 }).supplierStatus, "unavailable");
  assert.equal(normalizeWalthersItem({ ...item, quantityavailable: 3 }).supplierStatus, "low");
});

test("negative or fractional stock is explicitly unknown, not rounded or converted", () => {
  for (const quantity of [-1, 1.5]) {
    const result = normalizeWalthersItem({ ...item, quantityavailable: quantity });
    assert.equal(result.supplierStock, null);
    assert.equal(result.supplierStatus, "unknown");
    assert.ok(result.quantityNote?.includes(String(quantity)));
  }
});

test("malformed quantities, prices, and identifiers fail before import", () => {
  for (const patch of [
    { quantityavailable: Number.NaN },
    { onlinecustomerprice: -1 }, { onlinecustomerprice: Number.POSITIVE_INFINITY },
    { internalid: 0.5 }, { itemid: "" },
  ]) assert.throws(() => normalizeWalthersItem({ ...item, ...patch }));
});