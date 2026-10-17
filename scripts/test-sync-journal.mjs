/** Exact proposed SQL + real journal adapter, disposable PostgreSQL ONLY.
 * All subprocesses have a clean environment; explicit local Unix socket; no TCP,
 * app DB imports, application URLs, credentials, Shopify or real catalog data. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tsh-sync-journal-review-"));
const socket = path.join(temp, "socket"); fs.mkdirSync(socket, { mode: 0o700 });
const env = { PATH: process.env.PATH, HOME: temp, TMPDIR: temp, LANG: "C", LC_ALL: "C" };
const run = (cmd, args) => execFileSync(cmd, args, { env, encoding: "utf8", stdio: "pipe" });
const psqlArgs = ["-X", "-h", socket, "-p", "55449", "-U", "tsh_sync_review", "-d", "postgres", "-v", "ON_ERROR_STOP=1"];
let started = false, pool;
try {
  run("initdb", ["-D", path.join(temp, "data"), "-A", "trust", "--no-locale", "--encoding=UTF8", "-U", "tsh_sync_review"]);
  run("pg_ctl", ["-D", path.join(temp, "data"), "-l", path.join(temp, "postgres.log"),
    "-o", `-h '' -k ${socket} -p 55449`, "-w", "start"]); started = true;
  run("psql", [...psqlArgs, "-f", "docs/launch/sync-journal-proposed.sql"]);
  const require = createRequire(path.resolve("lib/db/package.json"));
  const { Pool } = require("pg");
  pool = new Pool({ host: socket, port: 55449, user: "tsh_sync_review", database: "postgres", max: 2,
    connectionTimeoutMillis: 5000, options: "-c statement_timeout=5000" });
  assert.equal((await pool.query("SELECT current_database() AS db")).rows[0].db, "postgres");
  const esbuild = path.resolve("artifacts/api-server/node_modules/esbuild/bin/esbuild");
  // A single entrypoint shares the opaque-plan registry between planner/journal.
  const entry = path.join(temp, "entry.mjs");
  fs.writeFileSync(entry, `export { buildSyncPlan, digest } from ${JSON.stringify(path.resolve("artifacts/api-server/src/lib/synchronization-plan.ts"))};
export { inspectSyncRecovery, resolveExplicitlyReviewedSyncRun } from ${JSON.stringify(path.resolve("artifacts/api-server/src/lib/synchronization-recovery.ts"))};
export { PostgresSyncJournal } from ${JSON.stringify(path.resolve("artifacts/api-server/src/lib/synchronization-journal.ts"))};`);
  const bundle = path.join(temp, "journal.mjs");
  run(esbuild, [entry, "--bundle", "--platform=node", "--format=esm", `--outfile=${bundle}`, "--log-level=warning"]);
  const { buildSyncPlan, digest, PostgresSyncJournal, inspectSyncRecovery, resolveExplicitlyReviewedSyncRun } = await import(pathToFileURL(bundle).href);
  const now = Date.now(), at = new Date(now - 1000).toISOString();
  const suppliers = ["Heartland Hobby Wholesale", "HobbyTyme", "Walthers", "MMD/Squadron"];
  const input = {
    policy: { shopDomain: "fixture.myshopify.com", currency: "USD", locationId: "gid://shopify/Location/1",
      selection: "combine", supplierMetafields: false, maxAgeMinutes: Object.fromEntries(suppliers.map(s => [s, 60])),
      safetyStock: 1, maxQuantity: 50, lowerBounds: "hold", pricing: { mode: "preserve" },
      maxChangedVariants: 10, maxZeroedVariants: 1, maxQuantityDelta: 50, maxPriceChangeBasisPoints: 10000, maxPlanAgeSeconds: 120 },
    snapshot: { shopDomain: "fixture.myshopify.com", currency: "USD", verifiedAt: at, complete: true,
      scopes: ["read_products", "read_inventory", "read_locations", "write_inventory"],
      variants: [{ variantId: "gid://shopify/ProductVariant/1", productId: "gid://shopify/Product/1",
        inventoryItemId: "gid://shopify/InventoryItem/1", sku: "SYNTHETIC", identityFingerprint: "a".repeat(64),
        active: true, tracked: true, locationId: "gid://shopify/Location/1", locationActive: true,
        quantity: 0, committedQuantity: 0, price: "1.00" }] },
    mappings: [{ id: "mapping-fixture", revision: 1, state: "approved", supplier: "HobbyTyme",
      originalSku: "SYNTHETIC", variantId: "gid://shopify/ProductVariant/1", identityFingerprint: "a".repeat(64), sellingUnitsVerified: true }],
    offers: [{ source: { supplier: "HobbyTyme", sku: "SYNTHETIC", supplierStock: 12, supplierStatus: "available",
      supplierUpdatedAt: new Date(at), raw: { "On Hand": "12" } }, cost: null }], nowMs: now,
  };
  const journal = new PostgresSyncJournal(pool), plan = buildSyncPlan(input);
  assert.equal(plan.operations.length, 1);
  const session = await journal.reserve(plan, { reviewerId: "isolated-owner" });
  await assert.rejects(journal.reserve(buildSyncPlan(input), { reviewerId: "isolated-owner" })); // cross-run durable lease
  await assert.rejects(session.append({ state: "complete" }));
  await assert.rejects(session.append({ state: "confirmed", operationId: "f".repeat(64) }));
  const operationId = digest({ plan: plan.digest, index: 0, op: plan.operations[0] });
  await session.append({ state: "intent", operationId });
  await assert.rejects(session.append({ state: "intent", operationId })); // no duplicate intent
  await session.append({ state: "confirmed", operationId });
  await session.append({ state: "complete" }); await session.release();
  assert.equal((await pool.query("SELECT confirmed_count FROM shopify_sync_runs WHERE run_id=$1", [plan.runId])).rows[0].confirmed_count, 1);
  await assert.rejects(pool.query("DELETE FROM shopify_sync_events"));
  await assert.rejects(pool.query("UPDATE shopify_sync_events SET state='complete'"));
  await assert.rejects(pool.query("TRUNCATE shopify_sync_runs,shopify_sync_events"));
  await assert.rejects(pool.query("UPDATE shopify_sync_runs SET approved_by='tampered' WHERE run_id=$1", [plan.runId]));
  const uncertain = buildSyncPlan(input), second = await journal.reserve(uncertain, { reviewerId: "isolated-owner" });
  await second.append({ state: "outcome_unknown" });
  await assert.rejects(second.release());
  const cold = new PostgresSyncJournal(pool);
  await assert.rejects(cold.reserve(buildSyncPlan(input), { reviewerId: "isolated-owner" }));
  await assert.rejects(pool.query("UPDATE shopify_sync_runs SET state='precondition_failed' WHERE run_id=$1", [uncertain.runId]));
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM shopify_sync_events")).rows[0].n, 4);
  const recovery = await inspectSyncRecovery({ pool, runId: uncertain.runId, readCurrentValue: async op => op.before });
  const verifyOwner = async () => ({ reviewerId: "isolated-recovery-reviewer" });
  await assert.rejects(resolveExplicitlyReviewedSyncRun({ pool, report: { ...recovery }, evidence: {}, verifyOwner }));
  await resolveExplicitlyReviewedSyncRun({ pool, report: recovery, evidence: {}, verifyOwner });
  await assert.rejects(resolveExplicitlyReviewedSyncRun({ pool, report: recovery, evidence: {}, verifyOwner }));
  assert.equal((await pool.query("SELECT state FROM shopify_sync_runs WHERE run_id=$1", [uncertain.runId])).rows[0].state, "reconciled");
  const final = await cold.reserve(buildSyncPlan(input), { reviewerId: "isolated-owner" });
  await final.append({ state: "precondition_failed" }); await final.release();
  // Rollback shape verified only in this disposable DB, never drop real evidence.
  await pool.query("BEGIN; DROP TABLE public.shopify_sync_events; DROP TABLE public.shopify_sync_runs; DROP FUNCTION public.shopify_sync_protect(); COMMIT;");
  assert.equal((await pool.query("SELECT to_regclass('public.shopify_sync_runs') AS t")).rows[0].t, null);
  console.log("PASS: exact SQL creation, actual adapter transactions, owner identity, durable cross-run/cold-start lease, intent/confirmation ordering, immutable audit, unknown-outcome retention, and disposable rollback.");
  console.log("No application database or Shopify connection used.");
} finally {
  if (pool) await pool.end();
  if (started) run("pg_ctl", ["-D", path.join(temp, "data"), "-m", "fast", "-w", "stop"]);
}
