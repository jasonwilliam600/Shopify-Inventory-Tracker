import { test } from "node:test";
import assert from "node:assert/strict";
import { readWalthersCatalog, type CatalogPage } from "./walthers-catalog";

const brandKey = "custitem_walthers_item_brand";
function product(id: number) { return { internalid: id, itemid: `999-${id}`, quantityavailable: 1 }; }

test("partitions large catalogs and never requests an offset beyond the search cap", async () => {
  const requests: number[] = [];
  const records = await readWalthersCatalog(async (filters, offset) => {
    requests.push(offset);
    if (!filters[brandKey]) return {
      total: 5001, items: [], facets: [{ id: brandKey, values: [{ url: "A" }, { url: "B" }] }],
    };
    const total = filters[brandKey] === "A" ? 5000 : 1;
    const start = filters[brandKey] === "A" ? offset + 1 : 5001;
    return { total, items: Array.from({ length: Math.min(100, total - offset) }, (_, index) => product(start + index)) };
  }, () => {});
  assert.equal(records.length, 5001);
  assert.equal(new Set(records.map((item) => item.internalid)).size, 5001);
  assert.ok(requests.every((offset) => offset < 5000));
});

test("rejects a truncated page rather than silently saving partial stock", async () => {
  await assert.rejects(readWalthersCatalog(async () => ({ total: 2, items: [product(1)] }), () => {}), /incomplete/);
});

test("rejects overlapping partitions", async () => {
  await assert.rejects(readWalthersCatalog(async () => ({
    total: 2, items: [product(1), product(1)],
  }), () => {}), /repeated/);
});

test("rejects missing facet coverage after all pages finish", async () => {
  await assert.rejects(readWalthersCatalog(async (filters, offset): Promise<CatalogPage> => {
    if (filters.q) return { total: 0, items: [] };
    if (!filters[brandKey]) return {
      total: 5001, items: [], facets: [{ id: brandKey, values: [{ url: "A" }, { url: "B" }] }],
    };
    if (filters[brandKey] === "B") return { total: 0, items: [] };
    return { total: 5000, items: Array.from({ length: 100 }, (_, index) => product(offset + index + 1)) };
  }, () => {}), /partitions are incomplete/);
});

test("recovers unclassified products through SKU searches without counting overlaps", async () => {
  const records = await readWalthersCatalog(async (filters, offset): Promise<CatalogPage> => {
    if (filters.q) return { total: 2, items: [product(1), product(5001)] };
    if (!filters[brandKey]) return {
      total: 5001, items: [], facets: [{ id: brandKey, values: [{ url: "A" }, { url: "B" }] }],
    };
    if (filters[brandKey] === "B") return { total: 0, items: [] };
    return { total: 5000, items: Array.from({ length: 100 }, (_, index) => product(offset + index + 1)) };
  }, () => {});
  assert.equal(records.length, 5001);
  assert.equal(records.filter((record) => record.internalid === 1).length, 1);
});

test("rejects a changing catalog between pages", async () => {
  await assert.rejects(readWalthersCatalog(async (_filters, offset) => ({
    total: offset ? 102 : 101,
    items: Array.from({ length: offset ? 2 : 100 }, (_, index) => product(offset + index + 1)),
  }), () => {}), /changed during download/);
});