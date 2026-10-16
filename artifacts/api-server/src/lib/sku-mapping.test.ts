import assert from "node:assert/strict";
import { test } from "node:test";
import { mapSupplierSkuToStore, STORE_PREFIX_MAPPINGS, MMD_PREFIX_MAPPINGS, APPROVED_CATALOG_MAPPINGS } from "./sku-mapping";
import approvedCatalog from "./approved-catalog-sku-mappings.json";

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

test("confirmed Walthers Woodland Scenics code follows the store's no-hyphen format", () => {
  for (const [source, target] of [
    ["785-105", "WDS105"], ["785-109", "WDS109"],
    ["785-1101", "WDS1101"], ["785-A00125", "WDSA00125"],
    [" 785-00125A/06 ", "WDS00125A/06"], ["785-FS640", "WDSFS640"],
  ]) assert.equal(mapSupplierSkuToStore(source, "Walthers"), target);
  for (const sku of ["785", "785-", "785--105", "785105", "785/105", "785_105", "187-105", "WDS105"]) {
    assert.equal(mapSupplierSkuToStore(sku, "Walthers"), null);
  }
  for (const supplier of ["Heartland Hobby Wholesale", "HobbyTyme", "MMD/Squadron", null]) {
    assert.equal(mapSupplierSkuToStore("785-105", supplier), null);
  }
  assert.equal(mapSupplierSkuToStore("WOO/105", "HobbyTyme"), "WDS-105");
});

test("only the merchant-confirmed MMD prefixes gain store-format candidates", () => {
  for (const [source, target] of Object.entries(MMD_PREFIX_MAPPINGS)) {
    if (source === "EDU" || source === "MIN") continue; // No-hyphen exceptions are tested separately.
    for (const separator of ["/", "-", "_", ":", " ", ""]) {
      assert.equal(mapSupplierSkuToStore(`${source}${separator}00125A/06`, "MMD/Squadron"), `${target}-00125A/06`);
    }
  }
  for (const [sku, target] of [
    ["AAM4403", "AAM-4403"], ["TAM60402", "TAM-60402"],
    ["TRP0203", "TRP-0203"], ["SCL110", "SCL-110"],
    ["MBL03201", "MTB-03201"], [" mbl/00042 ", "MTB-00042"],
    ["ACD12105", "ACY-12105"], ["EVG100", "EVG-100"],
    ["EDU00001", "EDU00001"], [" edu/00125A/06 ", "EDU00125A/06"],
    ["MIN16005", "MIA16005"], [" min/00042 ", "MIA00042"],
    ["HBB80130", "HBB-80130"], ["ICM14401", "ICM-14401"],
    ["acd/00125A/06", "ACY-00125A/06"], ["evg-00042", "EVG-00042"],
    [" tam/00042 ", "TAM-00042"],
  ]) assert.equal(mapSupplierSkuToStore(sku, "MMD/Squadron"), target);
});

test("Eduard matches existing no-hyphen store SKUs without changing the part number", () => {
  for (const separator of ["/", "-", "_", ":", " ", ""]) {
    assert.equal(mapSupplierSkuToStore(`EDU${separator}00001`, "MMD/Squadron"), "EDU00001");
    assert.equal(mapSupplierSkuToStore(`EDU${separator}00125A-06`, "MMD/Squadron"), "EDU00125A-06");
  }
  assert.equal(mapSupplierSkuToStore(" edu00001 ", "MMD/Squadron"), "EDU00001");
  assert.equal(mapSupplierSkuToStore("EDU00001", "Walthers"), null);
  assert.equal(mapSupplierSkuToStore("TAM00001", "MMD/Squadron"), "TAM-00001");
});

test("CSV-supported MMD rules follow existing store formatting and retain full identifiers", () => {
  for (const separator of ["/", "-", "_", ":", " ", ""]) {
    assert.equal(mapSupplierSkuToStore(`MIN${separator}00125A/06`, "MMD/Squadron"), "MIA00125A/06");
    assert.equal(mapSupplierSkuToStore(`HBB${separator}00125A/06`, "MMD/Squadron"), "HBB-00125A/06");
    assert.equal(mapSupplierSkuToStore(`ICM${separator}00125A/06`, "MMD/Squadron"), "ICM-00125A/06");
  }
  assert.equal(mapSupplierSkuToStore("MIA16005", "MMD/Squadron"), null);
  assert.equal(mapSupplierSkuToStore("VJ70103", "MMD/Squadron"), "VAL70103");
  assert.equal(mapSupplierSkuToStore("TAM00001", "MMD/Squadron"), "TAM-00001");
});

test("all approved suggestions are exact supplier-scoped item candidates", () => {
  assert.equal(approvedCatalog.approvedRuleCount, 46);
  let count = 0;
  for (const [supplier, items] of Object.entries(APPROVED_CATALOG_MAPPINGS)) {
    for (const [source, target] of Object.entries(items)) {
      assert.equal(mapSupplierSkuToStore(source, supplier), target);
      assert.equal(mapSupplierSkuToStore(` ${source} `, supplier), target);
      assert.equal(mapSupplierSkuToStore(source, "Unknown supplier"), null);
      count += target !== null ? 1 : 0;
    }
  }
  assert.equal(count, approvedCatalog.candidateCount);
  assert.equal(count, 4774);
});

test("approved item exceptions preserve exact store case, separators, and distinct series", () => {
  for (const [supplier, source, target] of [
    ["Walthers", "785-5878", "WOO5878"],
    ["MMD/Squadron", "TAM87170", "TAM/87170"],
    ["MMD/Squadron", "HBB84520", "Hbb-84520"],
    ["MMD/Squadron", "ICM72075", "IBG-72075"],
    ["MMD/Squadron", "ACD12355", "ACD-12355"],
    ["MMD/Squadron", "TAK8004", "TAO-8004"],
    ["MMD/Squadron", "RYE5070", "RFM-5070"],
    ["MMD/Squadron", "CP72011", "CPP-72011"],
    ["MMD/Squadron", "CPD72011", "CPP-72011"],
  ]) assert.equal(mapSupplierSkuToStore(source, supplier), target);
  assert.equal(mapSupplierSkuToStore("TAK999999", "MMD/Squadron"), null);
  assert.equal(mapSupplierSkuToStore("RYE999999", "MMD/Squadron"), null);
  assert.equal(mapSupplierSkuToStore("187-999999", "Walthers"), null);
  assert.equal(mapSupplierSkuToStore("CPX72011", "MMD/Squadron"), null);
  assert.equal(mapSupplierSkuToStore("CPD72011", "Walthers"), null);
  assert.ok(approvedCatalog.reviewFlags["MMD/Squadron"]["CPD72011"]);
});

test("MMD approval does not extend to other prefixes or suppliers", () => {
  for (const sku of ["AA16", "WOO123", "ZZZ123", "12551", "TAM", "TAM/", "TAM//12551", "MBL", "MBL/", "MBL//03201", "ACD", "ACD/", "EVG", "EVG/", "EVG//100", "EDU", "EDU/", "EDU//00001", ""]) {
    assert.equal(mapSupplierSkuToStore(sku, "MMD/Squadron"), null);
  }
  for (const prefix of ["MIN", "HBB", "ICM"]) {
    for (const sku of [prefix, `${prefix}/`, `${prefix}//00125`]) {
      assert.equal(mapSupplierSkuToStore(sku, "MMD/Squadron"), null);
    }
  }
  for (const prefix of Object.keys(MMD_PREFIX_MAPPINGS)) {
    for (const supplier of ["Heartland Hobby Wholesale", "HobbyTyme", "Walthers", null]) {
      const existingTargets: Record<string, string> = { MBL: "MTB", ACD: "ACY", EVG: "EVG" };
      const existingTarget = (supplier === "Heartland Hobby Wholesale" || supplier === "HobbyTyme") ? existingTargets[prefix] : undefined;
      assert.equal(mapSupplierSkuToStore(`${prefix}00125`, supplier), existingTarget ? `${existingTarget}-00125` : null);
    }
  }
});