import assert from "node:assert/strict";
import { test } from "node:test";
import { groupDistributorOffers, type GroupOffer } from "./inventory-groups";

const suppliers = ["HobbyTyme", "Heartland Hobby Wholesale"];
function offer(supplier: string, sku: string, quantity: number | null): GroupOffer {
  return {
    groupKey: "sku:ACY-12551", mappedStoreSku: "ACY-12551", sku, supplier,
    productName: "Model", variant: "Default", supplierStock: quantity,
    supplierStatus: quantity === null ? "unknown" : quantity ? "available" : "unavailable",
    supplierUpdatedAt: "2026-10-03T12:00:00.000Z", supplierPrice: 10, stockText: String(quantity),
  };
}

test("3 plus 6 produces one candidate with distributor quantities, not published stock", () => {
  const [group] = groupDistributorOffers([
    offer(suppliers[0], "ACD/12551", 3), offer(suppliers[1], "ACY12551", 6),
  ], suppliers);
  assert.equal(group.distributorTotal, 9);
  assert.equal(group.sku, "ACY-12551");
  assert.deepEqual(group.distributors.map((d) => d.reportedQuantity), [3, 6]);
  assert.deepEqual(group.distributors.map((d) => d.sourceSku), ["ACD/12551", "ACY12551"]);
  assert.equal(group.mappingState, "candidate");
  assert.equal(group.shopifySellableStock, null);
  assert(group.distributors.every((d) => d.shopifyLocationId === null));
});

test("same-supplier mapping collisions exclude all ambiguous offers", () => {
  const [group] = groupDistributorOffers([
    offer(suppliers[0], "ACD/12551", 3), offer(suppliers[0], "ACY-12551", 4),
    offer(suppliers[1], "ACY12551", 6),
  ], suppliers);
  assert.equal(group.distributorTotal, null);
  assert.equal(group.knownSubtotal, 6);
  assert.equal(group.mappingState, "conflict");
  assert.equal(group.status, "review");
  assert(group.distributors.slice(0, 2).every((d) => d.mappingConflict && d.countedQuantity === null));
});

test("unknown or missing stock is never invented as zero", () => {
  const [unknown] = groupDistributorOffers([
    offer(suppliers[0], "ACD/12551", 3), offer(suppliers[1], "ACY12551", null),
  ], suppliers);
  assert.equal(unknown.distributorTotal, null);
  assert.equal(unknown.knownSubtotal, 3);
  const [missing] = groupDistributorOffers([offer(suppliers[0], "ACD/12551", 3)], suppliers);
  assert.deepEqual(missing.missingSuppliers, [suppliers[1]]);
  assert.equal(missing.distributorTotal, 3);
});

test("zero availability and bounded piece quantities retain feed meaning", () => {
  const bounded = { ...offer(suppliers[0], "ACD/00125", 100), stockText: "100+" };
  const [group] = groupDistributorOffers([bounded, offer(suppliers[1], "ACY00125", 0)], suppliers);
  assert.equal(group.distributorTotal, 100);
  assert.equal(group.boundedQuantity, true);
  const [zero] = groupDistributorOffers([offer(suppliers[0], "ACD/12551", 0)], suppliers);
  assert.equal(zero.distributorTotal, 0);
  assert.equal(zero.status, "unavailable");
});