import assert from "node:assert/strict";
import { test } from "node:test";
import approvedCatalog from "./approved-catalog-sku-mappings.json";
import { REJECTED_MAPPINGS, mappingHold } from "./supplier-mapping-policy";
import { matchesMappingReview } from "./mapping-review-filter";

test("review filters preserve all source holds and overlapping flagged rejections", () => {
  const pairs = new Map<string, { supplier: string; originalSku: string; mappingStatus: string }>();
  for (const [supplier, flags] of Object.entries(approvedCatalog.reviewFlags)) {
    for (const originalSku of Object.keys(flags)) {
      pairs.set(`${supplier}\0${originalSku}`, { supplier, originalSku, mappingStatus: mappingHold(supplier, originalSku)?.status === "rejected" ? "rejected" : "flagged" });
    }
  }
  for (const originalSku of Object.keys(REJECTED_MAPPINGS)) {
    pairs.set(`MMD/Squadron\0${originalSku}`, { supplier: "MMD/Squadron", originalSku, mappingStatus: "rejected" });
  }
  const rows = [...pairs.values()];
  assert.equal(rows.filter(row => matchesMappingReview(row, "held")).length, 209);
  assert.equal(rows.filter(row => matchesMappingReview(row, "flagged")).length, 200);
  assert.equal(rows.filter(row => matchesMappingReview(row, "rejected")).length, 12);
  assert.equal(rows.filter(row => matchesMappingReview(row, "all")).length, 209);
  for (const row of rows) {
    assert.ok(matchesMappingReview({ ...row, originalSku: ` ${row.originalSku.toLowerCase()} ` }, "held"));
  }
  const ordinary = { supplier: "HobbyTyme", originalSku: "NOT-A-PROTECTED-SOURCE", mappingStatus: "candidate" };
  assert.equal(matchesMappingReview(ordinary, "held"), false);
  assert.equal(matchesMappingReview(ordinary, "flagged"), false);
  assert.equal(matchesMappingReview(ordinary, "candidate"), true);
});
