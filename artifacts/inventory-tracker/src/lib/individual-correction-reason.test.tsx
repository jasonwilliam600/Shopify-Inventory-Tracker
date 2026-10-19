import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { INDIVIDUAL_CORRECTION_REASONS, IndividualCorrectionReasonField, resolveIndividualReason } from "./individual-correction-reason";

test("all six choices render, default requires no typing, only Other displays required text", () => {
  assert.equal(INDIVIDUAL_CORRECTION_REASONS.length, 6);
  assert.equal(INDIVIDUAL_CORRECTION_REASONS[0], "Manually verified product match");
  for (const choice of INDIVIDUAL_CORRECTION_REASONS) {
    const html = renderToStaticMarkup(<IndividualCorrectionReasonField choice={choice} other=""
      onChoice={() => {}} onOther={() => {}} />);
    assert.equal((html.match(/<option /g) ?? []).length, 6);
    assert.ok(html.includes(`value="${choice}" selected=""`));
    assert.equal(html.includes("<textarea"), choice === "Other reason");
    if (choice === "Other reason") {
      assert.ok(html.includes('minLength="12"'));
      assert.ok(html.includes('maxLength="2000"'));
      assert.equal(resolveIndividualReason(choice, ""), "");
    } else assert.equal(resolveIndividualReason(choice, ""), choice);
  }
});

test("Other validates trimmed length, rejects invalid choices, and ignores hidden stale text", () => {
  for (const other of ["", "   ", "12345678901", " 12345678901 ", "x".repeat(2001)]) {
    assert.equal(resolveIndividualReason("Other reason", other), "");
  }
  assert.equal(resolveIndividualReason("Other reason", " 123456789012 "), "123456789012");
  assert.equal(resolveIndividualReason("Other reason", "x".repeat(2000)), "x".repeat(2000));
  assert.equal(resolveIndividualReason("Invalid", "A valid length reason"), "");
  assert.equal(resolveIndividualReason(INDIVIDUAL_CORRECTION_REASONS[0], "Previously typed other text"), INDIVIDUAL_CORRECTION_REASONS[0]);
});
