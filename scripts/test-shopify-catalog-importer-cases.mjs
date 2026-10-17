// Not a real DB command. Only the isolated launcher may supply these arguments.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const [socket, bundle] = process.argv.slice(2);
if (!/^\/tmp\/tsh-catalog-import-review\.[A-Za-z0-9]+\/socket$/.test(socket ?? "")
  || bundle !== path.join(path.dirname(socket), "importer.mjs")) throw new Error("ISOLATED_LAUNCHER_REQUIRED");
globalThis.fetch = () => { throw new Error("NETWORK_FORBIDDEN"); };
const require = createRequire(path.resolve("lib/db/package.json"));
const { Pool } = require("pg");
const pool = new Pool({ host: socket, port: 55447, user: "tsh_catalog_review", database: "tsh_catalog_review",
  password: "DISPOSABLE_TRUST_FIXTURE", ssl: false, max: 6, connectionTimeoutMillis: 2000,
  application_name: "tsh_isolated_import_tests" });
const mod = await import(pathToFileURL(bundle));
const schema = fs.readFileSync("reports/sku-mapping-final-schema-review/final-proposed-revised.sql", "utf8");
const schemaHash = hash(Buffer.from(schema));
const shop = "fixture.myshopify.com";
const results = [];
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function node(i) {
  return { id: `gid://shopify/ProductVariant/${i}`, sku: i <= 5 ? [null, "", " ", "Twin", " twin "][i - 1] : `SKU-${i}`,
    title: "Variant 日本語 '); DROP TABLE suppliers; --", selectedOptions: [{ name: "Size", value: "Small" }],
    inventoryItem: { id: `gid://shopify/InventoryItem/${i}` },
    product: { id: `gid://shopify/Product/${i}`, title: "Fixture", vendor: "Vendor",
      status: ["ACTIVE", "ARCHIVED", "DRAFT"][(i - 1) % 3] } };
}
function identity(n) {
  return { shopDomain: shop, variantId: n.id, productId: n.product.id, inventoryItemId: n.inventoryItem?.id ?? null,
    sku: n.sku, productTitle: n.product.title, variantTitle: n.title, vendor: n.product.vendor,
    options: n.selectedOptions, productStatus: n.product.status ?? null };
}
// Independently generate the synthetic expected manifest, not from parser output.
function digestIdentities(identities) {
  const h = createHash("sha256");
  for (const v of [...identities].sort((a, b) => a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0)) {
    const options = [...v.options].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    h.update(JSON.stringify([v.shopDomain, v.variantId, v.productId, v.inventoryItemId, v.sku,
      v.productTitle, v.variantTitle, v.vendor, options, v.productStatus]) + "\n");
  }
  return h.digest("hex");
}
function fixture(count = 8, transform = n => n) {
  const now = Date.now(), identities = [], rawHash = createHash("sha256");
  let bytes = 0;
  for (let i = 1; i <= count; i++) {
    const n = transform(node(i), i), raw = Buffer.from(JSON.stringify(n) + "\n");
    identities.push(identity(n)); bytes += raw.byteLength; rawHash.update(raw);
  }
  const evidence = { source: "live_shopify", retrievalMode: "bulk", apiVersion: "2026-07", layout: "variant_roots",
    shopDomain: shop, scopes: ["read_products"], expectedVariantCount: count,
    operation: { id: "gid://shopify/BulkOperation/1", type: "QUERY", status: "COMPLETED", errorCode: null,
      createdAt: new Date(now - 180000).toISOString(), completedAt: new Date(now - 120000).toISOString(),
      querySha256: "a".repeat(64), rootObjectCount: count, objectCount: count, fileSizeBytes: bytes },
    download: { source: "shopify_bulk_query_result", resultKind: "complete",
      operationId: "gid://shopify/BulkOperation/1", shopDomain: shop, querySha256: "a".repeat(64),
      resultUrlSha256: "b".repeat(64), downloadedAt: new Date(now - 60000).toISOString(), transportComplete: true,
      expectedSha256: rawHash.digest("hex") },
    reconciliation: { source: "independent_live_observation", observationReference: "independent-fixture-observation",
      shopDomain: shop, querySha256: "a".repeat(64), observedAt: new Date(now - 30000).toISOString(),
      variantCount: count, identityDigestSha256: digestIdentities(identities) } };
  return { runId: randomUUID(), expectedShopDomain: shop, expectedVariantCount: count,
    evidence, policy: { nowMs: now, maxAgeMs: 3600000 },
    chunks: { async *[Symbol.asyncIterator]() {
      for (let i = 1; i <= count; i++) yield Buffer.from(JSON.stringify(transform(node(i), i)) + "\n");
    } } };
}
async function reset() {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await pool.query(schema);
  await pool.query("CREATE TABLE public.supplier_inventory (id integer PRIMARY KEY,quantity integer NOT NULL); INSERT INTO public.supplier_inventory VALUES (1,17)");
}
async function counts() {
  const result = await pool.query(`SELECT (SELECT count(*) FROM shopify_variant_catalog)::int AS catalog,
    (SELECT count(*) FROM supplier_mapping_decisions)::int AS decisions,
    (SELECT count(*) FROM supplier_mapping_audit_events)::int AS audits,
    (SELECT count(*) FROM supplier_mapping_hold_resolutions)::int AS resolutions`);
  return result.rows[0];
}
const empty = { catalog: 0, decisions: 0, audits: 0, resolutions: 0 };
function inputFor(plan, override = {}) {
  const bytes = mod.initialCatalogManifest(plan);
  return { pool, plan, approval: { environment: "development", expectedDatabaseName: "tsh_catalog_review",
    expectedShopDomain: shop, expectedVariantCount: plan.variantCount, approvedManifestSha256: plan.manifestSha256,
    manifestReference: `private-manifest:${plan.runId}` },
    archive: { readManifest: async () => bytes }, ...override };
}
function decoratedPool(decorate) {
  return { connect: async () => {
    const client = await pool.connect();
    return { query: (sql, values) => decorate(sql, values, () => client.query(sql, values)),
      release: destroy => client.release(destroy) };
  } };
}
async function plan(count = 8) { return mod.prepareInitialCatalogImport(fixture(count)); }
async function seedCatalog() {
  const v = identity(node(7)), fingerprint = digestIdentities([v]);
  await pool.query(`INSERT INTO shopify_variant_catalog
    (shop_domain,variant_gid,product_gid,inventory_item_gid,sku,title,vendor,selected_options,identity_fingerprint,live_verified_at,active)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,now(),true)`,
  [shop, v.variantId, v.productId, v.inventoryItemId, v.sku, v.productTitle + " · " + v.variantTitle,
    v.vendor, JSON.stringify(v.options), fingerprint]);
  return { ...v, fingerprint };
}
async function seedApprovedMapping(v) {
  const id = randomUUID(), client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO supplier_mapping_decisions
      (id,supplier_id,original_supplier_sku,shop_domain,variant_gid,state,version,product_identity_snapshot,selling_unit_snapshot)
      VALUES ($1,'Heartland Hobby Wholesale','OFFLINE-UNHELD-FIXTURE',$2,$3,'approved',1,$4::jsonb,$5::jsonb)`,
    [id, shop, v.variantId, JSON.stringify({ shop_domain: shop, variant_gid: v.variantId, product_gid: v.productId,
      sku: v.sku, selected_options: v.options, identity_fingerprint: v.fingerprint }),
    JSON.stringify({ confirmed: true, retail_units_per_supplier_unit: 1, unit_label: "piece" })]);
    await client.query(`INSERT INTO supplier_mapping_audit_events
      (decision_id,decision_version,action,reviewer_issuer,reviewer_subject,request_id,reason,before_state,after_state,evidence)
      SELECT id,version,'approve','isolated-fixture','reviewer',$2,'Isolated trigger fixture',NULL,to_jsonb(d),'{}'::jsonb
      FROM supplier_mapping_decisions d WHERE id=$1`, [id, randomUUID()]);
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
  return id;
}
async function test(name, fn) {
  await reset();
  await fn();
  assert.equal((await pool.query("SELECT quantity FROM supplier_inventory WHERE id=1")).rows[0].quantity, 17);
  results.push(name); console.log(`PASS ${name}`);
}
try {
  await test("42,308 variants import atomically; statuses, original SKUs, flags and provenance retained", async () => {
    const p = await plan(42308), input = inputFor(p), manifest = JSON.parse(Buffer.from(mod.initialCatalogManifest(p)));
    assert.equal(p.missingSkuCount, 3); assert.equal(p.duplicateSkuVariantCount, 2);
    assert.deepEqual(p.productStatusCounts, { ACTIVE: 14103, ARCHIVED: 14103, DRAFT: 14102 });
    assert.equal(manifest.variants.length, 42308);
    assert.equal(manifest.variants[1].sku, "");
    assert.equal(manifest.variants[4].sku, " twin ");
    assert.equal(manifest.variants[4].skuStatus, "duplicate");
    assert.equal(manifest.variants[4].relationshipVerified, false);
    assert.equal(manifest.reconciliation.variantCount, 42308);
    const baseline = (await pool.query("SELECT pg_get_functiondef('tsh_mapping_base_holds(text,text)'::regprocedure) AS body")).rows[0].body;
    let inserts = 0;
    input.pool = decoratedPool(async (sql, values, next) => {
      if (sql.startsWith("INSERT")) {
        inserts++; assert.ok(sql.startsWith("INSERT INTO public.shopify_variant_catalog"));
        assert.ok(values.length > 0); assert.ok(!sql.includes("DROP TABLE suppliers"));
      }
      assert.ok(!/^(UPDATE|DELETE|TRUNCATE|ALTER|DROP)/.test(sql));
      return next();
    });
    const imported = await mod.importInitialDevelopmentCatalog(input);
    assert.equal(imported.inserted, 42308); assert.equal(inserts, 85);
    assert.deepEqual(await counts(), { ...empty, catalog: 42308 });
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM shopify_variant_catalog WHERE active")).rows[0].n, 42308);
    assert.equal((await pool.query("SELECT sku FROM shopify_variant_catalog WHERE variant_gid=$1", ["gid://shopify/ProductVariant/1"])).rows[0].sku, null);
    assert.equal((await pool.query("SELECT pg_get_functiondef('tsh_mapping_base_holds(text,text)'::regprocedure) AS body")).rows[0].body, baseline);
  });
  await test("mid-import failure rolls back already inserted batches", async () => {
    const p = await plan(1001); let batches = 0;
    const bad = decoratedPool(async (sql, values, next) => {
      if (sql.startsWith("INSERT") && ++batches === 2) throw new Error("INJECTED");
      return next();
    });
    await assert.rejects(mod.importInitialDevelopmentCatalog(inputFor(p, { pool: bad })), /IMPORT_FAILED_DATABASE_ERROR/);
    assert.equal(batches, 2); assert.deepEqual(await counts(), empty);
  });
  await test("duplicate variant IDs fail before any import", async () => {
    await assert.rejects(mod.prepareInitialCatalogImport(fixture(2, () => node(1))), /DUPLICATE_VARIANT_ID/);
    assert.deepEqual(await counts(), empty);
  });
  await test("invalid GIDs and noncanonical zero IDs fail closed", async () => {
    await assert.rejects(mod.prepareInitialCatalogImport(fixture(1, n => ({ ...n, id: "bad" }))), /INVALID_PRODUCTVARIANT_ID/);
    await assert.rejects(mod.prepareInitialCatalogImport(fixture(1, n => ({ ...n, id: "gid://shopify/ProductVariant/0" }))), /INVALID_CANONICAL/);
  });
  await test("broken product-parent references fail closed", async () => {
    const f = fixture(1), n = node(1), { product, ...variant } = n;
    const raw = Buffer.from(JSON.stringify(product) + "\n" + JSON.stringify({ ...variant, __parentId: "gid://shopify/Product/999" }) + "\n");
    f.evidence.layout = "products_with_variants";
    f.evidence.operation.objectCount = 2; f.evidence.operation.rootObjectCount = 1;
    f.evidence.operation.fileSizeBytes = raw.byteLength; f.evidence.download.expectedSha256 = hash(raw);
    f.chunks = { async *[Symbol.asyncIterator]() { yield raw; } };
    await assert.rejects(mod.prepareInitialCatalogImport(f), /ORPHAN_BULK_VARIANT/);
  });
  await test("unexpected count, truncation and hash mismatch are rejected", async () => {
    const wrongCount = fixture(); wrongCount.expectedVariantCount++; wrongCount.evidence.expectedVariantCount++;
    await assert.rejects(mod.prepareInitialCatalogImport(wrongCount), /COMPLETENESS_MISMATCH/);
    const truncated = fixture(1), raw = Buffer.from(JSON.stringify(node(1)).slice(0, -8));
    truncated.chunks = { async *[Symbol.asyncIterator]() { yield raw; } };
    await assert.rejects(mod.prepareInitialCatalogImport(truncated), /MALFORMED_BULK_JSONL/);
    const wrongHash = fixture(); wrongHash.evidence.download.expectedSha256 = "f".repeat(64);
    await assert.rejects(mod.prepareInitialCatalogImport(wrongHash), /DOWNLOAD_HASH_MISMATCH/);
  });
  await test("missing, mismatched, partial and wrong-version provenance is blocked", async () => {
    for (const change of [
      f => { f.evidence.download.transportComplete = false; },
      f => { f.evidence.download.operationId = "gid://shopify/BulkOperation/2"; },
      f => { f.evidence.operation.status = "FAILED"; },
      f => { f.evidence.operation.querySha256 = ""; },
      f => { f.evidence.apiVersion = "2026-10"; },
    ]) {
      const f = fixture(); change(f); await assert.rejects(mod.prepareInitialCatalogImport(f));
    }
  });
  await test("count alone cannot substitute for independent identity reconciliation", async () => {
    const f = fixture(); delete f.evidence.reconciliation;
    await assert.rejects(mod.prepareInitialCatalogImport(f), /RECONCILIATION_REQUIRED/);
    const changed = fixture(); changed.evidence.reconciliation.identityDigestSha256 = "c".repeat(64);
    await assert.rejects(mod.prepareInitialCatalogImport(changed), /IDENTITY_RECONCILIATION_MISMATCH/);
    const self = fixture(); self.evidence.reconciliation.observationReference = self.evidence.operation.id;
    await assert.rejects(mod.prepareInitialCatalogImport(self), /INVALID_RECONCILIATION_PROVENANCE/);
  });
  await test("UNLISTED and unknown status are retained without inventing availability", async () => {
    const f = fixture(2, (n, i) => ({ ...n, product: { ...n.product, status: i === 1 ? "UNLISTED" : null } }));
    const p = await mod.prepareInitialCatalogImport(f);
    assert.deepEqual(p.productStatusCounts, { UNLISTED: 1, UNKNOWN: 1 });
    await mod.importInitialDevelopmentCatalog(inputFor(p));
    assert.equal((await counts()).catalog, 2);
  });
  await test("protected manifest is allowlisted, copied and checksum-verified", async () => {
    const f = fixture(); f.evidence.download.url = "https://example.invalid/DO_NOT_ARCHIVE";
    f.evidence.credential = "OFFLINE_EXTRA_DO_NOT_ARCHIVE";
    const p = await mod.prepareInitialCatalogImport(f), bytes = mod.initialCatalogManifest(p);
    assert.ok(!Buffer.from(bytes).toString().includes("DO_NOT_ARCHIVE"));
    bytes[0] ^= 1;
    await assert.rejects(mod.importInitialDevelopmentCatalog(inputFor(p, { archive: { readManifest: async () => bytes } })), /MANIFEST_MISMATCH/);
    await assert.rejects(mod.importInitialDevelopmentCatalog(inputFor(p, { archive: { readManifest: async () => { throw new Error("offline"); } } })), /MANIFEST_UNAVAILABLE/);
    assert.equal(hash(mod.initialCatalogManifest(p)), p.manifestSha256);
    assert.deepEqual(await counts(), empty);
  });
  await test("forged plans, wrong approvals and production assertions are rejected", async () => {
    const p = await plan(), input = inputFor(p);
    await assert.rejects(mod.importInitialDevelopmentCatalog({ ...input, plan: { ...p } }), /UNVALIDATED_IMPORT_PLAN/);
    for (const field of [{ environment: "production" }, { expectedVariantCount: 1 },
      { expectedShopDomain: "wrong.myshopify.com" }, { approvedManifestSha256: "d".repeat(64) },
      { manifestReference: "https://example.invalid/private" }]) {
      await assert.rejects(mod.importInitialDevelopmentCatalog({ ...input, approval: { ...input.approval, ...field } }), /APPROVAL_MISMATCH/);
    }
  });
  await test("unexpected database identity aborts before writes", async () => {
    const input = inputFor(await plan()); input.approval.expectedDatabaseName = "not_the_review_database";
    await assert.rejects(mod.importInitialDevelopmentCatalog(input), /DATABASE_CONTEXT_MISMATCH/);
    assert.deepEqual(await counts(), empty);
  });
  await test("nonempty destination preserves all existing catalog data", async () => {
    await seedCatalog(); const before = (await pool.query("SELECT * FROM shopify_variant_catalog")).rows;
    await assert.rejects(mod.importInitialDevelopmentCatalog(inputFor(await plan())), /TABLES_NOT_EMPTY/);
    assert.deepEqual((await pool.query("SELECT * FROM shopify_variant_catalog")).rows, before);
  });
  await test("existing audited mapping is untouched by refused import", async () => {
    const v = await seedCatalog(), id = await seedApprovedMapping(v);
    const before = await counts();
    await assert.rejects(mod.importInitialDevelopmentCatalog(inputFor(await plan())), /TABLES_NOT_EMPTY/);
    assert.deepEqual(await counts(), before);
    assert.equal((await pool.query("SELECT state FROM supplier_mapping_decisions WHERE id=$1", [id])).rows[0].state, "approved");
  });
  await test("disabled protection trigger causes rollback, never bypass", async () => {
    await pool.query("ALTER TABLE supplier_mapping_decisions DISABLE TRIGGER mapping_validate_revision");
    await assert.rejects(mod.importInitialDevelopmentCatalog(inputFor(await plan())), /PROTECTION_TRIGGER_UNAVAILABLE/);
    assert.deepEqual(await counts(), empty);
  });
  await test("PostgreSQL insert-trigger failure rolls back prior rows", async () => {
    await pool.query(`CREATE FUNCTION reject_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.variant_gid='gid://shopify/ProductVariant/501' THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='isolated failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER reject_fixture BEFORE INSERT ON shopify_variant_catalog FOR EACH ROW EXECUTE FUNCTION reject_fixture()`);
    await assert.rejects(mod.importInitialDevelopmentCatalog(inputFor(await plan(1001))), /IMPORT_FAILED_23514/);
    assert.deepEqual(await counts(), empty);
  });
  await test("silent field alteration cannot pass count-only checks", async () => {
    await pool.query(`CREATE FUNCTION alter_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.sku='CORRUPTED-FIXTURE'; RETURN NEW; END; $$;
      CREATE TRIGGER alter_fixture BEFORE INSERT ON shopify_variant_catalog FOR EACH ROW EXECUTE FUNCTION alter_fixture()`);
    await assert.rejects(mod.importInitialDevelopmentCatalog(inputFor(await plan())), /IMPORT_READBACK_MISMATCH/);
    assert.deepEqual(await counts(), empty);
  });
  await test("normal readers see no partial catalog and concurrent writes are blocked", async () => {
    const p = await plan(1001);
    let release, reached;
    const barrier = new Promise(resolve => { release = resolve; });
    const inserted = new Promise(resolve => { reached = resolve; });
    let first = true;
    const paused = decoratedPool(async (sql, values, next) => {
      const result = await next();
      if (sql.startsWith("INSERT") && first) { first = false; reached(); await barrier; }
      return result;
    });
    const running = mod.importInitialDevelopmentCatalog(inputFor(p, { pool: paused }));
    try {
      await inserted; assert.deepEqual(await counts(), empty);
      const writer = await pool.connect();
      try {
        await writer.query("SET statement_timeout='100ms'");
        await assert.rejects(writer.query("INSERT INTO shopify_variant_catalog SELECT * FROM shopify_variant_catalog"), e => e.code === "57014");
      } finally { await writer.query("RESET statement_timeout"); writer.release(); }
    } finally { release(); }
    await running; assert.equal((await counts()).catalog, 1001);
  });
  await test("a writer committed while lock acquisition waits is seen by the empty guard", async () => {
    const p = await plan(), writer = await pool.connect();
    await writer.query("BEGIN");
    await writer.query("LOCK TABLE shopify_variant_catalog IN ROW EXCLUSIVE MODE");
    const running = mod.importInitialDevelopmentCatalog(inputFor(p));
    const outcome = running.then(() => null, e => e);
    try {
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        waiting = (await pool.query("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE relation='shopify_variant_catalog'::regclass AND NOT granted) AS waiting")).rows[0].waiting;
        if (waiting) break;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      assert.equal(waiting, true);
      await writer.query(`INSERT INTO shopify_variant_catalog
        (shop_domain,variant_gid,product_gid,title,identity_fingerprint,live_verified_at)
        VALUES ($1,$2,$3,'Concurrent fixture',$4,now())`,
      [shop, "gid://shopify/ProductVariant/999", "gid://shopify/Product/999", "f".repeat(64)]);
      await writer.query("COMMIT");
    } finally { await writer.query("ROLLBACK"); writer.release(); }
    assert.match((await outcome).code, /TABLES_NOT_EMPTY/);
    assert.equal((await counts()).catalog, 1);
  });
  await test("two concurrent initial imports cannot both succeed", async () => {
    const a = await plan(), b = await plan();
    const outcomes = await Promise.allSettled([mod.importInitialDevelopmentCatalog(inputFor(a)), mod.importInitialDevelopmentCatalog(inputFor(b))]);
    assert.equal(outcomes.filter(o => o.status === "fulfilled").length, 1);
    assert.match(outcomes.find(o => o.status === "rejected").reason.code, /TABLES_NOT_EMPTY/);
    assert.equal((await counts()).catalog, 8);
  });
  await test("lost COMMIT acknowledgement reports uncertainty and never retries inserts", async () => {
    const p = await plan(); let commits = 0;
    const uncertain = decoratedPool(async (sql, values, next) => {
      const result = await next();
      if (sql === "COMMIT") { commits++; throw new Error("fixture lost acknowledgement"); }
      return result;
    });
    await assert.rejects(mod.importInitialDevelopmentCatalog(inputFor(p, { pool: uncertain })), /COMMIT_OUTCOME_UNKNOWN/);
    assert.equal(commits, 1); assert.equal((await counts()).catalog, 8);
    await assert.rejects(mod.importInitialDevelopmentCatalog(inputFor(p)), /TABLES_NOT_EMPTY/);
  });
  await test("stale provenance and cancellation cannot commit", async () => {
    const f = fixture(); f.policy.maxAgeMs = 100000;
    const p = await mod.prepareInitialCatalogImport(f), input = inputFor(p);
    input.pool = decoratedPool(async (sql, values, next) => {
      if (sql.startsWith("LOCK TABLE")) {
        // Simulate a delay without waiting: expire the approved time budget
        // by advancing Date.now only around importer revalidation.
        const originalNow = Date.now; Date.now = () => originalNow() + 200000;
        try { return await next(); } finally { /* restored by test below */ }
      }
      return next();
    });
    const originalNow = Date.now;
    try { await assert.rejects(mod.importInitialDevelopmentCatalog(input), /IMPORT_FAILED_DATABASE_ERROR/); }
    finally { Date.now = originalNow; }
    assert.deepEqual(await counts(), empty);
    const controller = new AbortController(), cancelled = fixture(); cancelled.policy.signal = controller.signal;
    const cp = await mod.prepareInitialCatalogImport(cancelled); controller.abort();
    await assert.rejects(mod.importInitialDevelopmentCatalog(inputFor(cp)), /IMPORT_ABORTED/);
    assert.deepEqual(await counts(), empty);
  });
  await test("installed identity-change and append-only triggers remain effective", async () => {
    const v = await seedCatalog(), id = await seedApprovedMapping(v);
    await pool.query("UPDATE shopify_variant_catalog SET title=title || ' changed' WHERE variant_gid=$1", [v.variantId]);
    const decision = (await pool.query("SELECT state,version FROM supplier_mapping_decisions WHERE id=$1", [id])).rows[0];
    assert.equal(decision.state, "needs_review"); assert.equal(Number(decision.version), 2);
    assert.equal((await counts()).audits, 2);
    await assert.rejects(pool.query("DELETE FROM supplier_mapping_audit_events"), /append-only/);
    await assert.rejects(pool.query("TRUNCATE supplier_mapping_hold_resolutions"), /append-only/);
  });
  console.log(JSON.stringify({ passed: results.length, failed: 0, largestFixture: 42308, realDatabaseTouched: false,
    shopifyRequests: 0, schemaSha256: schemaHash }));
  fs.writeFileSync(path.join(path.dirname(socket), "test-results.json"), JSON.stringify({
    passed: results.length, failed: 0, tests: results, largestFixture: 42308, schemaSha256: schemaHash,
    realDatabaseTouched: false, shopifyRequests: 0,
  }, null, 2));
} finally { await pool.end(); }
