import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import approvedCatalog from "./approved-catalog-sku-mappings.json";
import { MAPPING_POLICY_COUNTS, mappingHold, REJECTED_MAPPINGS } from "./supplier-mapping-policy";
import { evaluateSupplierAvailability, quantityObservation, type AvailabilitySource, type CatalogVariant } from "./supplier-availability";
import { parseAvailabilityCatalog, loadAvailabilityCatalog } from "./supplier-availability-catalog";
import { mappingDiagnostics } from "./sku-mapping";

const now = new Date("2026-10-16T22:00:00Z");
function source(overrides: Partial<AvailabilitySource> = {}): AvailabilitySource {
  return {
    supplier: "HobbyTyme", sku: "ACD/12551", supplierStock: 12,
    supplierStatus: "available", supplierUpdatedAt: now, raw: { "On Hand": "12" }, ...overrides,
  };
}
function variant(sku = "ACY-12551", overrides: Partial<CatalogVariant> = {}): CatalogVariant {
  return { key: "historical:test", variantId: null, sku, title: "Test product", handle: "test",
    options: ["Default"], skuStatus: sku ? "unique" : "missing", ...overrides };
}
function evaluate(sources: AvailabilitySource[], variants = [variant()], known?: Set<string>) {
  return evaluateSupplierAvailability(variants, sources, known ?? new Set(variants.map(row => row.sku).filter(Boolean)), now);
}
function offer(s: AvailabilitySource) {
  return evaluate([s])[0].suppliers.find(row => row.supplier === s.supplier)!.offers[0];
}

test("all 12 rejected CSV relationships are hard exclusions, including case/whitespace bypasses", () => {
  const csv = readFileSync("../../reports/pre-sync-safety-review/rejected-candidate-mappings.csv", "utf8");
  const rows = parse(csv, { columns: true, bom: true }) as Record<string, string>[];
  assert.equal(rows.length, 12);
  for (const row of rows) {
    assert.equal(REJECTED_MAPPINGS[row["Supplier SKU"]], row["Proposed store SKU"]);
    for (const sku of [row["Supplier SKU"], ` ${row["Supplier SKU"].toLowerCase()} `]) {
      assert.equal(mappingHold(row.Supplier, sku)?.status, "rejected");
    }
    const result = evaluate([source({ supplier: row.Supplier, sku: row["Supplier SKU"] })], [variant(row["Proposed store SKU"])]);
    const excluded = result[0].suppliers.flatMap(supplier => supplier.offers);
    assert.equal(excluded.length, 0);
    assert.equal(mappingDiagnostics(row["Supplier SKU"], row.Supplier).legacyTarget, row["Proposed store SKU"]);
    assert.equal(mappingDiagnostics(row["Supplier SKU"], row.Supplier).trusted, false);
  }
});

test("all 200 flagged CSV candidates and exact identifiers remain held or rejected", () => {
  const csv = readFileSync("../../reports/pre-sync-safety-review/flagged-candidate-review.csv", "utf8");
  const rows = parse(csv, { columns: true, bom: true }) as Record<string, string>[];
  assert.equal(rows.length, 200);
  for (const row of rows) {
    assert.ok(mappingHold(row.Supplier, row["Supplier SKU"]));
    const result = evaluate([source({ supplier: row.Supplier, sku: row["Supplier SKU"] })], [variant(row["Proposed store SKU"])]);
    const held = result[0].suppliers.flatMap(supplier => supplier.offers);
    assert.equal(held.length, 0, row["Supplier SKU"]);
    assert.ok(mappingDiagnostics(row["Supplier SKU"], row.Supplier).hold);
    assert.equal(mappingDiagnostics(row["Supplier SKU"], row.Supplier).publishable, false);
  }
  assert.deepEqual(MAPPING_POLICY_COUNTS, { rejectedMappings: 12, flaggedCandidates: 200, uniqueHeldSources: 209 });
  assert.equal(Object.values(approvedCatalog.reviewFlags).reduce((n, rows) => n + Object.keys(rows).length, 0), 200);
});

test("exact raw SKU and exact mapping candidates are never verified", () => {
  const exact = offer(source({ sku: "ACY-12551" }));
  assert.equal(exact.mappingStatus, "candidate");
  assert.equal(exact.trusted, false);
  assert.equal(exact.publishable, false);
  assert.match(exact.mappingReason, /not verified/);
});

test("all four suppliers remain separate, with no combined or Shopify inventory number", () => {
  const row = evaluate([
    source(),
    source({ supplier: "Heartland Hobby Wholesale", sku: "ACY12551", raw: { ZCMQOH: "12" } }),
  ])[0];
  assert.equal(row.suppliers.length, 4);
  assert.equal(row.suppliers[0].offers[0].reportedQuantity, 12);
  assert.equal(row.suppliers[1].offers[0].reportedQuantity, 12);
  assert.equal(row.suppliers[2].offers.length, 0);
  assert.equal(row.suppliers[3].offers.length, 0);
  assert.equal("distributorTotal" in row, false);
  assert.equal("shopifyStock" in row, false);
});

test("all seven known same-supplier collisions retain every source and are blocked", () => {
  const groups: Record<string, string[]> = {
    "CPP-72011": ["CP72011", "CPA72011", "CPD72011"],
    "CPP-144001": ["CP144001", "CPA144001"],
    "CPP-72001": ["CPA72001", "CPD72001"],
    "CPP-72002": ["CP72002", "CPD72002"],
    "CPP-72007": ["CP72007", "CPA72007"],
    "CPP-72009": ["CP72009", "CPA72009"],
    "CPP-72016": ["CP72016", "CPA72016"],
  };
  for (const [target, skus] of Object.entries(groups)) {
    const row = evaluate(skus.map(sku => source({ supplier: "MMD/Squadron", sku, raw: { "Stock Level": "12" } })), [variant(target)])[0];
    const offers = row.suppliers[3].offers;
    assert.equal(offers.length, skus.filter(sku => !mappingHold("MMD/Squadron", sku)).length);
    for (const o of offers) {
      assert.match(o.mappingReason, /collision history/);
      assert.ok(["collision", "rejected", "held"].includes(o.mappingStatus));
      assert.equal(o.trusted, false);
    }
  }
});

test("new HobbyTyme BWL compact matches remain ambiguous for both duplicate Shopify SKUs", () => {
  for (const part of ["7826", "7931"]) {
    const rows = evaluate([source({ sku: `BWL/${part}` })], [
      variant(`BLI${part}`, { key: "a", skuStatus: "duplicate" }),
      variant(`BLI${part}`, { key: "b", skuStatus: "duplicate" }),
    ]);
    for (const row of rows) {
      const o = row.suppliers[1].offers[0];
      assert.equal(o.sourceSku, `BWL/${part}`);
      assert.equal(o.mappingStatus, "held");
      assert.equal(o.trusted, false);
      assert.equal(o.publishable, false);
    }
  }
});

test("duplicate SKUs remain separate historical variants and hold raw/exact matches", () => {
  const rows = evaluate([source()], [variant("ACY-12551", { skuStatus: "duplicate", key: "a" }), variant("ACY-12551", { skuStatus: "duplicate", key: "b" })]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].suppliers[1].offers[0].mappingStatus, "held");
  assert.equal(rows[1].suppliers[1].offers[0].mappingStatus, "held");
});

test("missing SKUs and missing supplier matches stay unknown, not zero", () => {
  const row = evaluate([], [variant("")])[0];
  assert.equal(row.skuStatus, "missing");
  assert.ok(row.suppliers.every(s => s.offers.length === 0));
});

test("one source matching multiple plausible catalog identifiers is held", () => {
  const rows = evaluate([source()], [variant(), variant("ACD/12551")]);
  for (const row of rows) assert.equal(row.suppliers[1].offers[0].mappingStatus, "held");
});

test("HobbyTyme stays individual pieces, regardless of wholesale ordering packs", () => {
  const q = quantityObservation(source({ raw: { "On Hand": "12", "Order Pack": "6" } }));
  assert.equal(q.reportedQuantity, 12);
  assert.equal(q.quantityKind, "exact");
  assert.match(q.stockReason, /individual pieces/);
});

test("blank, malformed, negative, null and coerced-zero quantities remain unknown", () => {
  for (const text of ["", "N/A", "12 pieces?", "-2", "1,2", "1.5"]) {
    assert.equal(quantityObservation(source({ supplierStock: 0, supplierStatus: "unavailable", raw: { "On Hand": text } })).quantityKind, "unknown", text);
  }
  assert.equal(quantityObservation(source({ supplierStock: null })).availability, "unknown");
  assert.equal(quantityObservation(source({ supplierStock: -2 })).availability, "unknown");
  assert.equal(quantityObservation(source({ supplierStatus: "unknown" })).availability, "unknown");
});

test("only an explicit fresh zero is shown as out-of-stock", () => {
  const zero = offer(source({ supplierStock: 0, supplierStatus: "unavailable", raw: { "On Hand": "0" } }));
  assert.equal(zero.reportedQuantity, 0);
  assert.equal(zero.availability, "out_of_stock");
  assert.equal(zero.freshness, "fresh");
  assert.equal(quantityObservation(source({ supplierStock: 0, supplierStatus: "unavailable", raw: { "On Hand": "12" } })).availability, "unknown");
});

test("lower and upper bounds preserve their original meaning without becoming exact", () => {
  for (const [text, count] of [["10+", 10], [">10", 11], [">=10", 10], ["≥10", 10]] as const) {
    const q = quantityObservation(source({ supplierStock: 10, raw: { "On Hand": text } }));
    assert.equal(q.quantityKind, "lower_bound");
    assert.equal(q.quantityText, text);
    assert.equal(q.reportedQuantity, count);
  }
  const upper = quantityObservation(source({ supplierStock: 10, raw: { "On Hand": "<10" } }));
  assert.equal(upper.quantityKind, "upper_bound");
  assert.equal(upper.availability, "unknown");
  assert.equal(quantityObservation(source({ supplierStock: 0, supplierStatus: "unavailable", raw: { "On Hand": "0+" } })).availability, "unknown");
});

test("all supplier display freshness thresholds work, including missing/future times", () => {
  const fixtures = [
    source({ supplierUpdatedAt: new Date(now.getTime() - 1441 * 60_000) }),
    source({ supplier: "Heartland Hobby Wholesale", sku: "ACY12551", supplierUpdatedAt: new Date(now.getTime() - 91 * 60_000), raw: { ZCMQOH: "12" } }),
    source({ supplier: "Walthers", sku: "ACY-12551", supplierUpdatedAt: new Date(now.getTime() - 181 * 60_000), raw: { quantityavailable: 12 } }),
    source({ supplier: "MMD/Squadron", sku: "ACY-12551", supplierUpdatedAt: new Date(now.getTime() - 181 * 60_000), raw: { "Stock Level": "12" } }),
  ];
  for (const row of fixtures) {
    assert.equal(offer(row).freshness, "stale");
    assert.equal(offer(row).reportedQuantity, 12);
  }
  for (const time of [null, "bad-date", new Date(now.getTime() + 10 * 60_000)]) {
    assert.equal(offer(source({ supplierUpdatedAt: time })).freshness, "unknown");
  }
});

test("MMD uses its authenticated dealer observation, not a differing older export", () => {
  const row = source({ supplier: "MMD/Squadron", sku: "TAM00001", supplierStock: 12,
    raw: { "Stock Level": "20", quantitySource: "Authenticated MMD dealer table", dealerStock: 12 } });
  assert.equal(quantityObservation(row).reportedQuantity, 12);
  assert.equal(quantityObservation({ ...row, supplierStock: 0, supplierStatus: "unavailable" }).availability, "unknown");
  assert.equal(quantityObservation({ ...row, raw: { quantitySource: "Authenticated MMD dealer table" } }).availability, "unknown");
});

test("catalog parser detects duplicate/missing SKUs without fabricating Shopify IDs", () => {
  const csv = '"Store SKU","Handle","Title","Option 1","Option 2","Option 3"\\n"A","one","One","Default","",""\\n"A","two","Two","Default","",""\\n"","three","Three","Default","",""'.replaceAll("\\n", "\n");
  const catalog = parseAvailabilityCatalog(csv, now.toISOString(), 3);
  assert.equal(catalog.metadata.duplicateSkuGroups, 1);
  assert.equal(catalog.metadata.missingSkuVariants, 1);
  assert.equal(catalog.metadata.containsVariantIds, false);
  assert.ok(catalog.variants.every(v => v.variantId === null && v.key.startsWith("historical:")));
  assert.equal(new Set(catalog.variants.map(v => v.key)).size, 3);
  assert.throws(() => parseAvailabilityCatalog(csv, now.toISOString(), 4), /INVALID/);
  assert.throws(() => parseAvailabilityCatalog("sku\nA", now.toISOString(), 1), /INVALID/);
  assert.throws(() => parseAvailabilityCatalog(csv, "bad", 3), /INVALID/);
});

test("existing historical export is complete and read-only, including all unpaired variants", async () => {
  const catalog = await loadAvailabilityCatalog();
  assert.equal(catalog.metadata.source, "historical");
  assert.equal(catalog.variants.length, 42309);
  assert.equal(catalog.metadata.duplicateSkuGroups, 154);
  assert.equal(catalog.metadata.missingSkuVariants, 21);
  assert.equal(catalog.metadata.verified, false);
  assert.equal(catalog.metadata.publishingEnabled, false);
  assert.equal(catalog.metadata.physicalStockExists, false);
});
