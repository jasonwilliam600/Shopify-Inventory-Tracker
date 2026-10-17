import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSyncPlan, digest, moneyCents } from "./synchronization-plan";
import { SynchronizationExecutor, type SyncPrecondition } from "./synchronization-executor";
import { ApplicationSynchronization } from "./application-synchronization";
import { CatalogLifecycle } from "./catalog-lifecycle";
import { SupplierSyncSchedule } from "./supplier-sync-schedule";
import { BLOCKED_SOURCE_PAIRS, MAPPING_POLICY_COUNTS } from "./supplier-mapping-policy";
import { SYNC_SUPPLIERS, type SyncPolicy, type SyncSnapshot, type SyncMapping, type SupplierSyncOffer } from "./synchronization-types";

const now = Date.now(), at = new Date(now - 1000).toISOString();
function fixture() {
  const policy: SyncPolicy = { shopDomain: "fixture.myshopify.com", currency: "USD", locationId: "gid://shopify/Location/1",
    supplierPriority: [...SYNC_SUPPLIERS], selection: "priority",
    maxAgeMinutes: Object.fromEntries(SYNC_SUPPLIERS.map(s => [s, 60])) as SyncPolicy["maxAgeMinutes"],
    safetyStock: 1, maxQuantity: 50, lowerBounds: "hold", pricing: { mode: "markup", basisPoints: 5000 },
    maxChangedVariants: 10, maxZeroedVariants: 1, maxQuantityDelta: 50, maxPriceChangeBasisPoints: 10000, maxPlanAgeSeconds: 120 };
  const snapshot: SyncSnapshot = { shopDomain: policy.shopDomain, currency: "USD", verifiedAt: at, complete: true,
    scopes: ["read_products", "read_inventory", "read_locations", "write_inventory", "write_products"],
    variants: [{ variantId: "gid://shopify/ProductVariant/1", productId: "gid://shopify/Product/1",
      inventoryItemId: "gid://shopify/InventoryItem/1", sku: "FIXTURE-1", identityFingerprint: "a".repeat(64),
      active: true, tracked: true, locationId: policy.locationId, locationActive: true, quantity: 2, committedQuantity: 2, price: "10.00" }] };
  const mappings: SyncMapping[] = [{ id: "mapping-1", revision: 1, state: "approved", supplier: "HobbyTyme",
    originalSku: "FIXTURE-1", variantId: snapshot.variants[0].variantId, identityFingerprint: "a".repeat(64), sellingUnitsVerified: true }];
  const offers: SupplierSyncOffer[] = [{ source: { supplier: "HobbyTyme", sku: "FIXTURE-1", supplierStock: 12,
    supplierStatus: "available", supplierUpdatedAt: new Date(at), raw: { "On Hand": "12" } },
    cost: { amount: "60.00", currency: "USD", basis: "pack", basisVerified: true, packSize: 6, observedAt: at } }];
  return { policy, snapshot, mappings, offers, nowMs: now };
}
test("individual HobbyTyme pieces, commitments, safety stock and verified pack COST are distinct", () => {
  const p = buildSyncPlan(fixture());
  assert.equal(p.operations.find(o => o.field === "inventory")?.after, 9); // 12 pieces - 2 committed - 1 buffer, NOT 72
  assert.equal(p.operations.find(o => o.field === "price")?.after, "15.00"); // $60/6 at 50% markup
  assert.equal(p.publishingEnabled, false);
  assert.equal(p.blockers.length, 0);
});
test("all four suppliers supported; selection never sums quantities and keeps original SKUs", () => {
  for (const supplier of SYNC_SUPPLIERS) {
    const f = fixture(); f.mappings[0].supplier = supplier; f.offers[0].source.supplier = supplier;
    f.offers[0].source.raw = { ZCMQOH: "12", "On Hand": "12", quantityavailable: "12", "Stock Level": "12" };
    const p = buildSyncPlan(f);
    assert.equal(p.operations.find(o => o.field === "inventory")?.after, 9);
    assert.equal(p.operations[0].originalSku, "FIXTURE-1");
  }
  const f = fixture();
  f.mappings.push({ ...f.mappings[0], id: "mapping-2", supplier: "Walthers", originalSku: "W-1" });
  f.offers.push({ source: { ...f.offers[0].source, supplier: "Walthers", sku: "W-1", supplierStock: 20,
    raw: { quantityavailable: "20" } }, cost: f.offers[0].cost });
  f.policy.selection = "maximum_available";
  assert.equal(buildSyncPlan(f).operations.find(o => o.field === "inventory")?.after, 17); // NOT 29
});
test("all 209 held source pairs remain centrally blocked even with an apparently approved mapping", () => {
  let checked = 0;
  for (const [supplier, skus] of Object.entries(BLOCKED_SOURCE_PAIRS)) for (const sku of Object.keys(skus)) {
    const f = fixture();
    f.mappings[0].supplier = supplier as SyncMapping["supplier"]; f.mappings[0].originalSku = sku;
    const p = buildSyncPlan(f);
    assert.equal(p.operations.length, 0);
    assert.ok(p.holds.some(h => h.code === "BLOCKED_SOURCE_HOLD"));
    checked++;
  }
  assert.equal(checked, 209);
  assert.ok(MAPPING_POLICY_COUNTS);
});
test("candidate mappings, ambiguous aliases, missing/duplicate Shopify SKUs never become trusted", () => {
  const candidate = fixture(); candidate.mappings[0].state = "candidate";
  assert.equal(buildSyncPlan(candidate).operations.length, 0);
  const aliases = fixture(); aliases.mappings.push({ ...aliases.mappings[0], id: "alias", originalSku: "OTHER" });
  assert.ok(buildSyncPlan(aliases).holds.some(h => h.code === "SAME_SUPPLIER_COLLISION"));
  const missing = fixture(); missing.snapshot.variants[0].sku = "";
  assert.equal(buildSyncPlan(missing).operations.length, 0);
  const duplicate = fixture(); duplicate.snapshot.variants.push({ ...duplicate.snapshot.variants[0],
    variantId: "gid://shopify/ProductVariant/2", inventoryItemId: "gid://shopify/InventoryItem/2", sku: " fixture-1 " });
  assert.equal(buildSyncPlan(duplicate).operations.length, 0);
});
test("stale/unknown/upper-bound quantities are held; lower bounds require an explicit floor policy", () => {
  for (const value of ["unknown", "<5"]) {
    const f = fixture(); f.offers[0].source.raw = { "On Hand": value };
    assert.equal(buildSyncPlan(f).operations.length, 0);
  }
  const stale = fixture(); stale.offers[0].source.supplierUpdatedAt = new Date(now - 7200000);
  assert.equal(buildSyncPlan(stale).operations.length, 0);
  const bounded = fixture(); bounded.offers[0].source.raw = { "On Hand": "12+" };
  assert.equal(buildSyncPlan(bounded).operations.length, 0);
  bounded.policy.lowerBounds = "use_floor";
  assert.equal(buildSyncPlan(bounded).operations.find(o => o.field === "inventory")?.after, 9);
});
test("unknown commitments, inactive products, wrong locations, missing scopes and incomplete snapshots fail closed", () => {
  const reserved = fixture(); reserved.snapshot.variants[0].committedQuantity = null;
  assert.equal(buildSyncPlan(reserved).operations.length, 0);
  const inactive = fixture(); inactive.snapshot.variants[0].active = false;
  assert.equal(buildSyncPlan(inactive).operations.length, 0);
  const location = fixture(); location.snapshot.variants[0].locationActive = false;
  assert.equal(buildSyncPlan(location).operations.length, 0);
  const scopes = fixture(); scopes.snapshot.scopes = ["read_products"];
  assert.ok(buildSyncPlan(scopes).blockers.includes("SHOPIFY_SCOPES_MISSING"));
  const incomplete = fixture(); incomplete.snapshot.complete = false;
  assert.ok(buildSyncPlan(incomplete).blockers.includes("CURRENT_COMPLETE_SHOP_SNAPSHOT_REQUIRED"));
  incomplete.snapshot.verifiedAt = "invalid";
  assert.ok(buildSyncPlan(incomplete).blockers.length);
});
test("pricing uses integer cents: markup differs from margin; unknown pack basis and MSRP cannot become costs", () => {
  const f = fixture(); f.policy.pricing = { mode: "margin", basisPoints: 5000 };
  assert.equal(buildSyncPlan(f).operations.find(o => o.field === "price")?.after, "20.00");
  for (const basis of ["unknown", "msrp"] as const) {
    const g = fixture(); g.offers[0].cost!.basis = basis;
    assert.equal(buildSyncPlan(g).operations.filter(o => o.field === "price").length, 0);
  }
  const unverified = fixture(); unverified.offers[0].cost!.basisVerified = false;
  assert.equal(buildSyncPlan(unverified).operations.filter(o => o.field === "price").length, 0);
  assert.equal(moneyCents("0.01"), 1);
  assert.throws(() => moneyCents("1e3"));
  assert.throws(() => moneyCents("0.001"));
  assert.throws(() => moneyCents("-1"));
});
test("destructive-change circuit breakers and incomplete-coverage zero protection", () => {
  const delta = fixture(); delta.policy.maxQuantityDelta = 1;
  assert.ok(buildSyncPlan(delta).blockers.includes("MAX_QUANTITY_DELTA_EXCEEDED"));
  const zero = fixture(); zero.offers[0].source.supplierStock = 0; zero.offers[0].source.supplierStatus = "unavailable";
  zero.offers[0].source.raw = { "On Hand": "0" }; zero.policy.maxZeroedVariants = 0;
  assert.ok(buildSyncPlan(zero).blockers.includes("MAX_ZEROED_VARIANTS_EXCEEDED"));
  zero.policy.maxZeroedVariants = 1;
  zero.mappings.push({ ...zero.mappings[0], id: "missing", supplier: "Walthers", originalSku: "MISSING" });
  assert.equal(buildSyncPlan(zero).operations.filter(o => o.field === "inventory").length, 0);
});
function executionFixture() {
  const f = fixture(), plan = buildSyncPlan(f), values = new Map(plan.operations.map(op => [op.field, op.before]));
  const events: string[] = [];
  let applies = 0, reserves = 0, releases = 0, reads = 0, failWrite = false, failJournal = false;
  let changed = false, failures = 0;
  const executor = new SynchronizationExecutor({
    now: () => now,
    authorization: { verify: async () => ({ reviewerId: "isolated-reviewer" }) },
    readRetry: { maxAttempts: 3, sleep: async () => {} },
    journal: { reserve: async () => {
      reserves++;
      return { append: async e => { if (failJournal) throw new Error("synthetic-journal-failure"); events.push(e.state); },
        release: async () => { releases++; } };
    } },
    transport: {
      readPrecondition: async op => {
        reads++; if (failures-- > 0) throw new Error("synthetic-read-failure");
        const p: SyncPrecondition = { shopDomain: plan.shopDomain, currency: "USD", identityFingerprint: op.identityFingerprint,
          mappingStillApproved: !changed, mappingRevision: op.mappingRevision, sourceFingerprint: op.sourceFingerprint,
          scopesVerified: true, locationId: op.locationId, locationActive: true, tracked: true,
          committedQuantity: op.committedQuantity, value: values.get(op.field)! };
        return p;
      },
      apply: async (op, context) => {
        applies++; assert.equal(context.requireCompareQuantity, true);
        assert.equal(events.at(-1), "intent");
        if (failWrite) throw new Error("synthetic-timeout");
        values.set(op.field, op.after); return { accepted: true };
      },
      readValue: async op => values.get(op.field)!,
    },
  });
  return { plan, executor, events, counts: () => ({ applies, reserves, releases, reads }),
    change: () => { changed = true; }, failWrite: () => { failWrite = true; },
    failJournal: () => { failJournal = true; }, failReads: () => { failures = 2; } };
}
test("exact owner grants, durable intent, CAS requirement, readback, completion and replay protection", async () => {
  const f = executionFixture();
  await assert.rejects(f.executor.executeExactPlan(f.plan, { opaque: true }), /EXACT_OWNER_APPROVAL/);
  assert.equal(f.counts().applies, 0);
  const grant = await f.executor.authorizeExactPlan(f.plan, {});
  const result = await f.executor.executeExactPlan(f.plan, grant);
  assert.equal(result.confirmed, 2);
  assert.deepEqual(f.events, ["intent", "confirmed", "intent", "confirmed", "complete"]);
  assert.equal(f.counts().releases, 1);
  await assert.rejects(f.executor.executeExactPlan(f.plan, grant));
  await assert.rejects(f.executor.authorizeExactPlan({ ...f.plan }, {}), /UNVALIDATED_SYNC_PLAN/);
});
test("changed mappings and failed journals stop before any Shopify mutation", async () => {
  const f = executionFixture(), grant = await f.executor.authorizeExactPlan(f.plan, {});
  f.change(); await assert.rejects(f.executor.executeExactPlan(f.plan, grant));
  assert.equal(f.counts().applies, 0);
  const j = executionFixture(), g = await j.executor.authorizeExactPlan(j.plan, {});
  j.failJournal(); await assert.rejects(j.executor.executeExactPlan(j.plan, g));
  assert.equal(j.counts().applies, 0);
});
test("read-only transient failures retry; ambiguous writes NEVER retry and retain the durable lease", async () => {
  const f = executionFixture(); f.failReads();
  await f.executor.executeExactPlan(f.plan, await f.executor.authorizeExactPlan(f.plan, {}));
  assert.ok(f.counts().reads > 4);
  const bad = executionFixture(); bad.failWrite();
  const grant = await bad.executor.authorizeExactPlan(bad.plan, {});
  await assert.rejects(bad.executor.executeExactPlan(bad.plan, grant), /REQUIRES_RECONCILIATION/);
  assert.equal(bad.counts().applies, 1);
  assert.equal(bad.counts().releases, 0);
  assert.equal(bad.executor.status().stopped, true);
  assert.equal(bad.events.at(-1), "outcome_unknown");
});
test("application composition and catalog lifecycle have no default live capabilities", async () => {
  const app = new ApplicationSynchronization();
  assert.equal(app.status().automaticSynchronizationEnabled, false);
  assert.equal(app.status().catalog.archiveConnected, false);
  assert.equal(app.status().suppliers.length, 4);
  await assert.rejects(app.dryRun(), /NOT_CONFIGURED/);
  const catalog = new CatalogLifecycle();
  await assert.rejects(catalog.readApprovedManifest("private-manifest:synthetic"), /NOT_CONNECTED/);
  let dbConnected = false;
  await assert.rejects(catalog.executeExplicitlyApprovedImport({ plan: {} as never, approval: {} as never,
    backup: {} as never, ownerApproved: true, pool: { connect: async () => { dbConnected = true; throw new Error(); } } }));
  assert.equal(dbConnected, false);
});
test("schedule is inert until authenticated activation; serializes and stops on scope drift", async () => {
  let callback: (() => void) | undefined, writes = 0, ticks = 0;
  const f = fixture(), plan = buildSyncPlan(f);
  const schedule = new SupplierSyncSchedule({
    now: () => now, verifyActivation: async () => ({ reviewerId: "isolated-reviewer" }),
    setTimer: fn => { callback = fn; return 1; }, clearTimer: () => {},
    dryRun: async () => { ticks++; return plan; },
    authorizeScopedPlan: async () => ({ opaque: true }),
    execute: async () => { writes++; },
  });
  assert.equal(callback, undefined); assert.equal(schedule.status().enabled, false);
  await schedule.activateExplicitlyApproved({ shopDomain: plan.shopDomain, policyDigest: plan.policyDigest,
    variantIds: [f.snapshot.variants[0].variantId], intervalMs: 60000, expiresAt: new Date(now + 3600000).toISOString() }, {});
  assert.equal(writes, 0);
  callback!();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ticks, 1); assert.equal(writes, 1);
  schedule.stop();
  const stopped = callback!; stopped();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes, 1);
  assert.equal(digest(f.policy), plan.policyDigest);
});
