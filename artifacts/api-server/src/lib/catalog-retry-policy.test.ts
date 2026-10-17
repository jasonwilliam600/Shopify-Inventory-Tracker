import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogThrottleDelay, parseCatalogThrottle, waitForCatalogBudget } from "./catalog-retry-policy";

test("rejects proactive throttle sleep exceeding deadline before sleeping or requesting", async () => {
  let calls = 0;
  const t = parseCatalogThrottle({ cost: { requestedQueryCost: 1000, throttleStatus: { currentlyAvailable: 0, restoreRate: 0.001 } } });
  await assert.rejects(waitForCatalogBudget(catalogThrottleDelay(t), 480000, new AbortController().signal,
    { now: () => 0, sleep: async () => { calls++; } }), /CATALOG_DEADLINE_EXCEEDED/);
  assert.equal(calls, 0);
});
test("rechecks clock after sleep so scheduler overshoot cannot issue a late request", async () => {
  let now = 0;
  await assert.rejects(waitForCatalogBudget(2000, 5000, new AbortController().signal,
    { now: () => now, sleep: async () => { now = 5001; } }), /CATALOG_DEADLINE_EXCEEDED/);
});
test("THROTTLED error envelopes preserve required capacity delay", () => {
  const envelope = { errors: [{ extensions: { code: "THROTTLED" } }],
    extensions: { cost: { requestedQueryCost: 100, throttleStatus: { currentlyAvailable: 0, restoreRate: 1 } } } };
  const throttle = parseCatalogThrottle(envelope.extensions);
  assert.equal(catalogThrottleDelay(throttle), 100000);
  assert.equal(Math.max(750, catalogThrottleDelay(throttle)), 100000);
});
test("budget waits are cancellable and finite, including zero-delay checks", async () => {
  const c = new AbortController(); c.abort();
  await assert.rejects(waitForCatalogBudget(0, 5000, c.signal, { now: () => 0, sleep: async () => {} }), /CATALOG_CANCELLED/);
  await assert.rejects(waitForCatalogBudget(0, Infinity, new AbortController().signal, { now: () => 0, sleep: async () => {} }), /INVALID_CATALOG_DEADLINE/);
});
test("invalid throttle metadata fails closed without raw error bodies", () => {
  assert.equal(parseCatalogThrottle(undefined), null);
  for (const value of [null, [], { cost: {} }, { cost: { requestedQueryCost: 10, throttleStatus: { currentlyAvailable: -1, restoreRate: 1 } } }]) {
    assert.throws(() => parseCatalogThrottle(value), /INVALID_THROTTLE_METADATA/);
  }
});
