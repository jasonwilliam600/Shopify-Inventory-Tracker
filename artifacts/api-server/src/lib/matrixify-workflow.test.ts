import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import ExcelJS from "exceljs";
import { MatrixifyWorkflow } from "./matrixify-workflow";
import { MappingApprovalRepository, supplierIdentityFingerprint, type CatalogRecord, type DecisionRecord, type SupplierRecord } from "./mapping-approval";
import { validateMatrixifyConfiguration, MATRIXIFY_NAMESPACE } from "./matrixify-configuration";
import { parseMatrixifyBaseline } from "./matrixify-baseline";
import { SYNC_SUPPLIERS } from "./synchronization-types";
import { SUPPLIER_METAFIELD_KEYS } from "./supplier-variant-metafields";
import { BLOCKED_SOURCE_PAIRS } from "./supplier-mapping-policy";
import { digest } from "./synchronization-plan";
import { reviewerAllowed, allowedReviewOrigin, requireMappingReviewer } from "./reviewer-authorization";
import { SynchronizationExecutor } from "./synchronization-executor";

const shop = "synthetic-test.myshopify.com", issuer = "test:isolated", subject = "synthetic-owner";
const reviewer = { issuer, subject }, now = Date.now();
const timestamp = new Date(now - 1000).toISOString(), fp = "a".repeat(64);
function fixture() {
  const catalog: CatalogRecord[] = [{
    shop_domain: shop, variant_gid: "gid://shopify/ProductVariant/2001", product_gid: "gid://shopify/Product/1001",
    inventory_item_gid: "gid://shopify/InventoryItem/3001", sku: "SYNTHETIC-ONLY",
    title: "Synthetic test item · Default Title", vendor: "Synthetic",
    selected_options: [{ name: "Title", value: "Default Title" }], identity_fingerprint: fp,
    live_verified_at: timestamp, active: true,
  }];
  const sources: SupplierRecord[] = SYNC_SUPPLIERS.map((supplier, i) => ({
    supplier, sku: `SYNTHETIC-${i}`, product_name: "Synthetic test item", supplier_status: "available",
    supplier_stock: [20, 15, 5, 7][i], supplier_price: i === 1 ? 5 : 10, supplier_updated_at: timestamp,
    imported_fields: { [["ZCMQOH", "On Hand", "quantityavailable", "Stock Level"][i]]: String([20, 15, 5, 7][i]) },
  }));
  const decisions: DecisionRecord[] = sources.map((s, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, supplier_id: s.supplier,
    original_supplier_sku: s.sku, shop_domain: shop, variant_gid: catalog[0].variant_gid, state: "approved", version: 1,
    product_identity_snapshot: { identity_fingerprint: fp },
    selling_unit_snapshot: { confirmed: true, retail_units_per_supplier_unit: 1, sourceIdentityFingerprint: supplierIdentityFingerprint(s),
      cost: { amount: i === 1 ? "5.00" : "10.00", basis: i === 1 ? "pack" : "piece",
        packSize: i === 1 ? 5 : 1, verifiedAt: timestamp } },
  }));
  const cfg = validateMatrixifyConfiguration({
    schemaVersion: 1, shopDomain: shop, currency: "USD", approvedBy: "synthetic-owner", approvedAt: timestamp,
    location: { id: "gid://shopify/Location/4001", name: "Synthetic supplier location", active: true,
      observedAt: timestamp, evidenceReference: "synthetic-location-evidence" },
    policy: { safetyStock: 2, maxQuantity: 100, lowerBounds: "hold",
      maxAgeMinutes: Object.fromEntries(SYNC_SUPPLIERS.map(s => [s, 60])),
      maxChangedVariants: 10, maxZeroedVariants: 0, maxQuantityDelta: 100,
      maxPriceChangeBasisPoints: 100000, maxPlanAgeSeconds: 300, pricing: { mode: "markup", basisPoints: 2500 } },
    pricingApproval: { approvedBy: "synthetic-owner", approvedAt: timestamp, policyDigest: digest({ mode: "markup", basisPoints: 2500 }) },
    metafieldNamespaceApproval: { approvedBy: "synthetic-owner", approvedAt: timestamp,
      acknowledgesOtherAdminAppsAccess: true, themeExposureReviewed: true, evidenceReference: "synthetic-private-theme-audit" },
    metafieldObservation: { shopDomain: shop, observedAt: timestamp, evidenceReference: "synthetic-private-definition-observation",
      definitions: SUPPLIER_METAFIELD_KEYS.map((key, i) => ({
        namespace: MATRIXIFY_NAMESPACE, key, ownerType: "PRODUCTVARIANT", type: { name: i === 0 ? "json" : "multi_line_text_field" },
        access: { admin: "PUBLIC_READ_WRITE", storefront: "NONE", customerAccount: "NONE" },
      })) },
  }, shop, now);
  const headers = ["ID", "Variant ID", "Variant SKU", "Variant Price", "Variant Inventory Tracker", "Title", "Vendor", "Status",
    "Option1 Name", "Option1 Value", `Inventory Available: ${cfg.location.name}`, `Inventory Committed: ${cfg.location.name}`];
  const csv = `${headers.join(",")}\n1001,2001,SYNTHETIC-ONLY,4.00,shopify,Synthetic test item,Synthetic,Active,Title,Default Title,0,4\n`;
  const data = { catalog, sources, decisions };
  let clock = now;
  const repo = { shop, readData: async () => structuredClone(data) };
  const workflow = new MatrixifyWorkflow(repo, async () => cfg, () => clock);
  return { cfg, csv, data, workflow, repo, setClock: (value: number) => { clock = value; } };
}
async function workbook(f: ReturnType<typeof fixture>, preview: Awaited<ReturnType<MatrixifyWorkflow["preview"]>>,
  profile: "inventory" | "supplier_metafields" | "prices") {
  const output = new PassThrough(), chunks: Buffer[] = [];
  output.on("data", chunk => chunks.push(Buffer.from(chunk)));
  await f.workflow.download({ previewId: preview.id, digest: preview.digest, profile }, reviewer, output);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.concat(chunks) as unknown as ExcelJS.Buffer);
  return book;
}
const previewInput = (f: ReturnType<typeof fixture>) => ({ baselineCsv: f.csv, baselineObservedAt: timestamp, baselineConfirmed: true });
test("four suppliers COMBINE, HobbyTyme pieces unchanged, lowest verified per-piece cost", async () => {
  const f = fixture(), p = await f.workflow.preview(previewInput(f), reviewer);
  assert.deepEqual(p.blockers, []);
  assert.equal(p.rows[0].afterQuantity, 41); // 20+15+5+7 - 2 buffer - 4 committed.
  assert.equal(p.rows[0].afterPrice, "1.25"); // 5USD/5-piece cost pack, NOT quantity conversion.
  assert.equal(p.rows[0].supplierSummary.length, 4);
  assert.equal(p.counts.metafieldRows, 1);
});
test("three round-tripped XLSX profiles use IDs and UPDATE only; no blank cross-field changes", async () => {
  const f = fixture(), p = await f.workflow.preview(previewInput(f), reviewer);
  for (const profile of ["inventory", "supplier_metafields", "prices"] as const) {
    const book = await workbook(f, p, profile), sheet = book.getWorksheet("Products")!;
    assert.equal(book.worksheets.length, 3);
    assert.equal(sheet.getCell("A2").value, "1001"); assert.equal(sheet.getCell("C2").value, "2001");
    assert.equal(sheet.getCell("B2").value, "UPDATE"); assert.equal(sheet.getCell("D2").value, "UPDATE");
    const headers = sheet.getRow(1).values as string[];
    assert.equal(headers.includes("Variant SKU"), false);
    assert.equal(headers.includes("Variant Inventory Tracker"), false);
    assert.equal(headers.includes("Variant Price"), profile === "prices");
    if (profile === "inventory") assert.equal(sheet.getCell("E2").value, 41);
    if (profile === "prices") assert.equal(sheet.getCell("E2").value, "1.25");
    if (profile === "supplier_metafields") {
      assert.equal(headers.some(h => typeof h === "string" && h.includes("$app:")), false);
      assert.match(String(sheet.getCell("F2").value), /SYNTHETIC-0/);
      assert.match(String(sheet.getCell("G2").value), /15/);
      assert.equal(sheet.getCell("E2").type, ExcelJS.ValueType.String);
    }
  }
});
test("all 209 source holds, including 12 terminal exclusions, fail BEFORE any SQL connection", async () => {
  let connections = 0, count = 0;
  const repo = new MappingApprovalRepository({ connect: async () => { connections++; throw new Error("FORBIDDEN"); } }, shop);
  for (const [supplier, skus] of Object.entries(BLOCKED_SOURCE_PAIRS)) for (const sku of Object.keys(skus)) {
    count++;
    await assert.rejects(repo.approve({ supplier, originalSku: sku, variantId: "gid://shopify/ProductVariant/2001",
      expectedVersion: null, identityFingerprint: fp, identityConfirmed: true, unitConfirmed: true,
      sourceIdentityFingerprint: fp,
      reason: "Synthetic hold must remain protected" }, reviewer), /PROTECTED_SOURCE_HOLD/);
  }
  assert.equal(count, 209); assert.equal(connections, 0);
});
test("unknown/stale/lower-bound supplier quantities are never invented or treated as verified exact stock", async () => {
  const f = fixture();
  f.data.sources[0].imported_fields = {};
  f.data.sources[1].supplier_updated_at = new Date(now - 61 * 60000).toISOString();
  f.data.sources[2].imported_fields = { quantityavailable: "5+" };
  const p = await f.workflow.preview(previewInput(f), reviewer);
  assert.equal(p.rows[0].afterQuantity, 1); // only fresh MMD7, less buffer2 and committed4.
  assert.ok(p.counts.exceptions >= 3);
});
test("draft/archive status is separate from SQL catalog membership; no inventory or price operations", async () => {
  const f = fixture(); f.csv = f.csv.replace(",Active,", ",Archived,");
  const p = await f.workflow.preview(previewInput(f), reviewer);
  assert.equal(p.counts.inventoryRows, 0); assert.equal(p.counts.priceRows, 0);
  assert.ok(p.counts.exceptions > 0);
});
test("duplicate and missing Shopify SKUs stay exceptions even with approved mappings", async () => {
  const f = fixture();
  f.data.catalog.push({ ...f.data.catalog[0], variant_gid: "gid://shopify/ProductVariant/2002", inventory_item_gid: "gid://shopify/InventoryItem/3002" });
  f.csv += "1001,2002,SYNTHETIC-ONLY,4.00,shopify,Synthetic test item,Synthetic,Active,Title,Default Title,0,0\n";
  const p = await f.workflow.preview(previewInput(f), reviewer);
  assert.equal(p.counts.inventoryRows, 0); assert.equal(p.counts.priceRows, 0); assert.equal(p.counts.metafieldRows, 0);
  const g = fixture(); g.data.catalog[0].sku = null; g.csv = g.csv.replace("2001,SYNTHETIC-ONLY,", "2001,,");
  const q = await g.workflow.preview(previewInput(g), reviewer); assert.equal(q.counts.inventoryRows, 0);
});
test("unverified/private-incompatible metafield definitions and unapproved price rules cannot be bypassed", async () => {
  const f = fixture(); f.cfg.metafieldObservation = null;
  const p = await f.workflow.preview(previewInput(f), reviewer); assert.equal(p.counts.metafieldRows, 0);
  f.cfg.policy.pricing = { mode: "preserve" }; f.cfg.pricingApproval = null;
  const q = await f.workflow.preview(previewInput(f), reviewer); assert.equal(q.counts.priceRows, 0);
});
test("download bound to reviewer, exact preview, freshness and unchanged supplier/mapping/config data", async () => {
  const f = fixture(), p = await f.workflow.preview(previewInput(f), reviewer);
  assert.throws(() => f.workflow.page(p.id, { issuer, subject: "other" }), /NOT_FOUND_OR_EXPIRED/);
  f.data.sources[0].supplier_stock = (f.data.sources[0].supplier_stock ?? 0) + 1;
  await assert.rejects(workbook(f, p, "inventory"), /INPUTS_CHANGED/);
  f.setClock(now + 301000); assert.throws(() => f.workflow.page(p.id, reviewer), /NOT_FOUND_OR_EXPIRED/);
  const g = fixture(), q = await g.workflow.preview(previewInput(g), reviewer), output = new PassThrough();
  await assert.rejects(g.workflow.download({ previewId: q.id, digest: "f".repeat(64), profile: "inventory" }, reviewer, output), /DIGEST_MISMATCH/);
});
test("baseline completeness, identity/options/vendor and exact location headers fail closed", () => {
  const f = fixture();
  for (const csv of [f.csv.split("\n")[0] + "\n", f.csv.replace("Synthetic supplier location", "Wrong location"),
    f.csv.replace("Default Title,0", "Different option,0"), f.csv.replace(",Synthetic,Active", ",Wrong vendor,Active")]) {
    assert.throws(() => parseMatrixifyBaseline(csv, f.data.catalog, f.cfg));
  }
});
test("IDs beyond IEEE754 precision and formula-like diagnostic values remain XLSX strings", async () => {
  const f = fixture();
  f.data.catalog[0].product_gid = "gid://shopify/Product/90071992547409931234";
  f.data.catalog[0].variant_gid = "gid://shopify/ProductVariant/90071992547409931235";
  for (const d of f.data.decisions) d.variant_gid = f.data.catalog[0].variant_gid;
  f.csv = f.csv.replace("1001,2001,", "90071992547409931234,90071992547409931235,");
  f.data.sources.push({ ...f.data.sources[0], sku: "=HYPERLINK(\"synthetic\")" });
  const p = await f.workflow.preview(previewInput(f), reviewer), book = await workbook(f, p, "inventory");
  assert.equal(book.getWorksheet("Products")!.getCell("C2").value, "90071992547409931235");
  const report = book.getWorksheet("TSH Exceptions")!;
  const cell = report.getCell(`D${report.rowCount}`);
  assert.equal(cell.type, ExcelJS.ValueType.String); assert.match(String(cell.value), /^=HYPERLINK/);
});
test("authentication is deny-by-default; client role or absent origin cannot confer authority", () => {
  assert.equal(reviewerAllowed("intruder", "owner"), false);
  assert.equal(reviewerAllowed("owner", ""), false);
  assert.equal(allowedReviewOrigin(undefined, "https://trusted.example"), false);
  assert.equal(allowedReviewOrigin("https://attacker.example", "https://trusted.example"), false);
  let status = 0, called = false;
  const res = { setHeader() {}, status(v: number) { status = v; return this; }, json() {}, locals: {} };
  requireMappingReviewer({ method: "POST", body: { role: "admin" } } as never, res as never, () => { called = true; });
  assert.equal(status, 401); assert.equal(called, false);
});
test("offline export authority can never be passed to the Shopify API executor", async () => {
  const executor = new SynchronizationExecutor({} as never);
  await assert.rejects(executor.authorizeExactPlan({ target: "matrixify_export" } as never, {}), /OFFLINE_EXPORT_CANNOT_AUTHORIZE_API_WRITES/);
});
test("full 42,308-row synthetic baseline validates without database or Shopify access", () => {
  const f = fixture(), count = 42308;
  const catalog = Array.from({ length: count }, (_, i) => ({
    ...f.data.catalog[0], product_gid: `gid://shopify/Product/${1000000 + i}`,
    variant_gid: `gid://shopify/ProductVariant/${2000000 + i}`,
    inventory_item_gid: `gid://shopify/InventoryItem/${3000000 + i}`, sku: `SYNTHETIC-${i}`,
  }));
  const csv = f.csv.split("\n")[0] + "\n" + catalog.map((c, i) =>
    `${1000000 + i},${2000000 + i},${c.sku},4.00,shopify,Synthetic test item,Synthetic,Active,Title,Default Title,0,0\n`).join("");
  const parsed = parseMatrixifyBaseline(csv, catalog, f.cfg);
  assert.equal(parsed.length, count);
  assert.equal(new Set(parsed.map(v => v.variantId)).size, count);
});
test("audited approval/revoke/conflict/rollback against EXACT installed schema, isolated PostgreSQL only",
  { skip: !process.env.TSH_MATRIXIFY_TEST_SOCKET }, async () => {
    assert.equal(process.env.DATABASE_URL, undefined);
    const pg = createRequire(path.resolve("lib/db/package.json"))("pg");
    const pool = new pg.Pool({ host: process.env.TSH_MATRIXIFY_TEST_SOCKET, port: 6544, user: "tsh_matrixify_test",
      database: "postgres", max: 3, connectionTimeoutMillis: 2000 });
    try {
      const sql = await readFile("reports/sku-mapping-final-schema-review/final-proposed-revised.sql", "utf8");
      await pool.query(sql);
      await pool.query(`CREATE TABLE supplier_inventory (supplier text,sku text,product_name text,supplier_stock int,
        supplier_status text,supplier_price double precision,supplier_updated_at timestamptz,imported_fields jsonb,
        PRIMARY KEY(supplier,sku))`);
      const f = fixture(), c = f.data.catalog[0];
      await pool.query(`INSERT INTO shopify_variant_catalog
        (shop_domain,variant_gid,product_gid,inventory_item_gid,sku,title,vendor,selected_options,identity_fingerprint,live_verified_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
      [shop,c.variant_gid,c.product_gid,c.inventory_item_gid,c.sku,c.title,c.vendor,JSON.stringify(c.selected_options),fp,timestamp]);
      for (const sku of ["SYNTHETIC-A", "SYNTHETIC-B"]) await pool.query(
        `INSERT INTO supplier_inventory VALUES('HobbyTyme',$1,'Synthetic',15,'available',5,$2,'{"On Hand":"15"}')`, [sku, timestamp]);
      const repo = new MappingApprovalRepository(pool, shop, () => now);
      const input = { supplier: "HobbyTyme", originalSku: "SYNTHETIC-A", variantId: c.variant_gid, expectedVersion: null,
        identityFingerprint: fp, identityConfirmed: true, unitConfirmed: true, reason: "Synthetic independently checked identity",
        sourceIdentityFingerprint: supplierIdentityFingerprint({ supplier: "HobbyTyme", sku: "SYNTHETIC-A", product_name: "Synthetic" }),
        costConfirmed: true, costBasis: "pack", packSize: 5, costEvidence: "Synthetic verified five-piece cost pack", expectedCostAmount: "5.00" };
      const a = await repo.approve(input, reviewer); assert.equal(a?.version, 1);
      assert.equal((await pool.query("SELECT count(*)::int n FROM supplier_mapping_audit_events")).rows[0].n, 1);
      await assert.rejects(repo.approve(input, reviewer), /REVISION_CHANGED/);
      const other = { ...input, originalSku: "SYNTHETIC-B",
        sourceIdentityFingerprint: supplierIdentityFingerprint({ supplier: "HobbyTyme", sku: "SYNTHETIC-B", product_name: "Synthetic" }) };
      await assert.rejects(repo.approve(other, reviewer), /MAPPING_CONFLICT/);
      await assert.rejects(repo.approve({ ...input, expectedVersion: 1, expectedCostAmount: "6.00" }, reviewer), /COST_CHANGED/);
      const r = await repo.revoke({ supplier: "HobbyTyme", originalSku: "SYNTHETIC-A", expectedVersion: 1,
        reason: "Synthetic reviewed approval revoked" }, reviewer);
      assert.equal(r?.version, 2);
      // A failing audit write must roll back its decision, not leave a half-save.
      const broken = new MappingApprovalRepository({ connect: async () => {
        const client = await pool.connect();
        return { query: async (sql: string, values?: unknown[]) => {
          if (sql.includes("INSERT INTO supplier_mapping_audit_events")) throw new Error("SYNTHETIC_AUDIT_FAILURE");
          return client.query(sql, values);
        }, release: () => client.release() };
      } }, shop, () => now);
      await assert.rejects(broken.approve(other, reviewer), /TRANSACTION_REJECTED/);
      assert.equal((await pool.query("SELECT count(*)::int n FROM supplier_mapping_decisions")).rows[0].n, 1);
      assert.equal((await pool.query("SELECT count(*)::int n FROM supplier_mapping_audit_events")).rows[0].n, 2);
      assert.equal((await pool.query("SELECT count(*)::int n FROM supplier_mapping_hold_resolutions")).rows[0].n, 0);
      assert.equal((await pool.query("SELECT sum(supplier_stock)::int n FROM supplier_inventory")).rows[0].n, 30);
    } finally { await pool.end(); }
  });
