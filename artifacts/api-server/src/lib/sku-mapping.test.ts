import assert from "node:assert/strict";
import { test } from "node:test";
import { mapSupplierSkuToStore, STORE_PREFIX_MAPPINGS } from "./sku-mapping";

test("merchant example converts the prefix and separator, not the part number", () => {
  assert.equal(mapSupplierSkuToStore("ACD/12551", "HobbyTyme"), "ACY-12551");
  assert.equal(mapSupplierSkuToStore("ACY12551", "Heartland Hobby Wholesale"), "ACY-12551");
  assert.equal(mapSupplierSkuToStore("ACY-12551", "Heartland Hobby Wholesale"), "ACY-12551");
});

test("all merchant prefixes preserve complete part numbers and leading zeros", () => {
  for (const [source, target] of Object.entries(STORE_PREFIX_MAPPINGS)) {
    for (const separator of ["/", "-", "_", ":", " ", ""]) {
      assert.equal(mapSupplierSkuToStore(`${source}${separator}00125A/06`, "HobbyTyme"), `${target}-00125A/06`);
    }
  }
  assert.equal(mapSupplierSkuToStore("kal/00042", "HobbyTyme"), "400-00042");
  assert.equal(mapSupplierSkuToStore("400-00042", "Heartland Hobby Wholesale"), "400-00042");
});

test("unknown prefixes and incomplete identifiers remain unmapped", () => {
  for (const sku of ["ZZZ/12551", "12551", "ACD", "ACD/", "ACD//12551", ""]) {
    assert.equal(mapSupplierSkuToStore(sku, "HobbyTyme"), null);
  }
  assert.equal(mapSupplierSkuToStore("ACD/12551", "Another wholesaler"), null);
  assert.equal(mapSupplierSkuToStore("ACD/12551", null), null);
});