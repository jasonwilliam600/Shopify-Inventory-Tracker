/**
 * UNCONNECTED DEVELOPMENT LIBRARY.
 * No default database, environment access, route, CLI, filesystem or Shopify I/O.
 * Importing this module never runs an import. A future caller needs separately
 * approved development DB access and a trusted, protected manifest archive.
 */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { parseBulkCatalog, prepareBulkCatalogRows } from "./shopify-bulk-catalog";
import type { BulkCatalogEvidence, BulkValidationPolicy, ParsedBulkCatalog } from "./shopify-bulk-catalog-contract";

export interface ImportClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  release(destroy?: boolean): void;
}
export interface ImportPool { connect(): Promise<ImportClient> }
export interface InitialCatalogPlan {
  readonly runId: string;
  readonly shopDomain: string;
  readonly variantCount: number;
  readonly missingSkuCount: number;
  readonly duplicateSkuVariantCount: number;
  readonly productStatusCounts: Readonly<Record<string, number>>;
  readonly manifestSha256: string;
  readonly manifestBytes: number;
  readonly relationshipVerified: false;
}
export interface DevelopmentImportApproval {
  environment: "development";
  expectedDatabaseName: string;
  expectedShopDomain: string;
  expectedVariantCount: number;
  approvedManifestSha256: string;
  /** Opaque private archive ID, never a URL or client-supplied path. */
  manifestReference: string;
}
export interface ProtectedManifestArchive {
  /** Trusted server-side adapter; no such durable adapter is installed yet. */
  readManifest(reference: string): Promise<Uint8Array>;
}
type Rows = ReturnType<typeof prepareBulkCatalogRows>;
const plans = new WeakMap<InitialCatalogPlan, {
  parsed: ParsedBulkCatalog; policy: BulkValidationPolicy; rows: Rows; manifest: Uint8Array;
}>();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const protectedTables = [
  "public.shopify_variant_catalog", "public.supplier_mapping_decisions",
  "public.supplier_mapping_audit_events", "public.supplier_mapping_hold_resolutions",
] as const;
const countSql = `SELECT
 (SELECT count(*) FROM public.shopify_variant_catalog)::text AS catalog,
 (SELECT count(*) FROM public.supplier_mapping_decisions)::text AS decisions,
 (SELECT count(*) FROM public.supplier_mapping_audit_events)::text AS audits,
 (SELECT count(*) FROM public.supplier_mapping_hold_resolutions)::text AS resolutions`;

export class CatalogImportError extends Error {
  constructor(readonly code: string) { super(code); this.name = "CatalogImportError"; }
}
const fail = (code: string): never => { throw new CatalogImportError(code); };

/** Offline preparation only. Actual uploaded shape is validated, never assumed. */
export async function prepareInitialCatalogImport(input: {
  chunks: AsyncIterable<Uint8Array>;
  evidence: BulkCatalogEvidence;
  policy: BulkValidationPolicy;
  runId: string;
  expectedShopDomain: string;
  expectedVariantCount: number;
}): Promise<InitialCatalogPlan> {
  const { runId, expectedShopDomain, expectedVariantCount } = input;
  const policy = { ...input.policy };
  if (!uuid.test(runId) || !Number.isSafeInteger(expectedVariantCount)
    || expectedVariantCount <= 0) fail("INVALID_IMPORT_PLAN");
  if (input.evidence.shopDomain !== expectedShopDomain
    || input.evidence.expectedVariantCount !== expectedVariantCount) fail("IMPORT_SOURCE_MISMATCH");
  const parsed = await parseBulkCatalog(input.chunks, input.evidence, policy);
  // Includes independent identity reconciliation; count-only witnesses fail.
  const rows = prepareBulkCatalogRows(parsed, policy);
  for (const v of parsed.identities) {
    for (const id of [v.variantId, v.productId, v.inventoryItemId].filter(id => id !== null)) {
      if (!/\/[1-9][0-9]*$/.test(id!)) fail("INVALID_CANONICAL_SHOPIFY_ID");
    }
  }
  const statusCounts: Record<string, number> = {};
  for (const v of parsed.identities) {
    const status = v.productStatus ?? "UNKNOWN";
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
  }
  const e = parsed.evidence;
  if (!e.scopes.every(s => typeof s === "string" && /^[a-z][a-z0-9_]*$/.test(s))
    || !/^(?:gid:\/\/shopify\/BulkOperation\/[1-9][0-9]*|[a-z0-9][a-z0-9_.:-]{0,199})$/i
      .test(e.reconciliation!.observationReference)) fail("INVALID_ARCHIVE_PROVENANCE_REFERENCE");
  // Explicit allowlist: do not archive unknown receipt fields, raw signed URLs,
  // query responses, sessions or credential-bearing transport objects.
  const manifest = Buffer.from(JSON.stringify({
    kind: "tsh-initial-catalog-import-v1", runId,
    shopDomain: e.shopDomain, apiVersion: e.apiVersion, layout: e.layout,
    expectedVariantCount, scopes: [...e.scopes],
    operation: { id: e.operation.id, type: e.operation.type, status: e.operation.status,
      errorCode: e.operation.errorCode, createdAt: e.operation.createdAt, completedAt: e.operation.completedAt,
      querySha256: e.operation.querySha256, rootObjectCount: e.operation.rootObjectCount,
      objectCount: e.operation.objectCount, fileSizeBytes: e.operation.fileSizeBytes },
    download: { source: e.download.source, resultKind: e.download.resultKind,
      operationId: e.download.operationId, shopDomain: e.download.shopDomain,
      querySha256: e.download.querySha256, resultUrlSha256: e.download.resultUrlSha256,
      downloadedAt: e.download.downloadedAt, transportComplete: e.download.transportComplete,
      expectedSha256: e.download.expectedSha256 },
    reconciliation: e.reconciliation && {
      source: e.reconciliation.source, observationReference: e.reconciliation.observationReference,
      shopDomain: e.reconciliation.shopDomain, querySha256: e.reconciliation.querySha256,
      observedAt: e.reconciliation.observedAt, variantCount: e.reconciliation.variantCount,
      identityDigestSha256: e.reconciliation.identityDigestSha256,
    },
    freshnessMaxAgeMs: policy.maxAgeMs, receipt: parsed.receipt,
    // Retains separate titles, product status, original SKU and review flags.
    // SQL active=true denotes catalog membership, NOT product availability.
    variants: parsed.identities,
  }) + "\n", "utf8");
  const plan: InitialCatalogPlan = Object.freeze({
    runId, shopDomain: e.shopDomain, variantCount: rows.length,
    missingSkuCount: parsed.identities.filter(v => v.skuStatus === "missing").length,
    duplicateSkuVariantCount: parsed.identities.filter(v => v.skuStatus === "duplicate").length,
    productStatusCounts: Object.freeze(statusCounts),
    manifestSha256: sha(manifest), manifestBytes: manifest.byteLength, relationshipVerified: false,
  });
  plans.set(plan, { parsed, rows, manifest, policy });
  return plan;
}

/** A copy for a future approved private archive, never an automatic file write. */
export function initialCatalogManifest(plan: InitialCatalogPlan): Uint8Array {
  const state = plans.get(plan);
  if (!state) return fail("UNVALIDATED_IMPORT_PLAN");
  return Uint8Array.from(state.manifest);
}

/**
 * Future explicitly approved DEVELOPMENT execution only.
 * All SQL writes are INSERTs to catalog, within one locked transaction.
 * Database name and environment assertions are guardrails, not independent
 * proof of environment; the future trusted caller must select the approved pool.
 */
export async function importInitialDevelopmentCatalog(input: {
  pool: ImportPool; plan: InitialCatalogPlan; approval: DevelopmentImportApproval;
  archive: ProtectedManifestArchive;
}): Promise<{ runId: string; inserted: number; manifestReference: string; manifestSha256: string }> {
  const { plan, approval } = input;
  const state = plans.get(plan);
  if (!state) return fail("UNVALIDATED_IMPORT_PLAN");
  if (approval.environment !== "development" || !/^[a-z_][a-z0-9_-]{0,62}$/.test(approval.expectedDatabaseName)
    || approval.expectedShopDomain !== plan.shopDomain || approval.expectedVariantCount !== plan.variantCount
    || approval.approvedManifestSha256 !== plan.manifestSha256
    || approval.manifestReference !== `private-manifest:${plan.runId}`) fail("IMPORT_APPROVAL_MISMATCH");
  let archived: Uint8Array;
  try { archived = await input.archive.readManifest(approval.manifestReference); }
  catch { return fail("PROTECTED_MANIFEST_UNAVAILABLE"); }
  if (!(archived instanceof Uint8Array) || archived.byteLength !== plan.manifestBytes
    || sha(archived) !== plan.manifestSha256) fail("PROTECTED_MANIFEST_MISMATCH");
  const revalidate = () => prepareBulkCatalogRows(state.parsed, { ...state.policy, nowMs: Date.now() });
  revalidate();
  let client: ImportClient;
  try { client = await input.pool.connect(); } catch { return fail("IMPORT_CONNECTION_FAILED"); }
  let begun = false, commitAttempted = false, destroy = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    begun = true;
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    const context = (await client.query(
      "SELECT current_database() AS database_name, current_setting('session_replication_role') AS replication_role",
    )).rows[0];
    if (context?.database_name !== approval.expectedDatabaseName || context?.replication_role !== "origin") {
      fail("IMPORT_DATABASE_CONTEXT_MISMATCH");
    }
    // EXCLUSIVE permits ordinary SELECT, but blocks competing writes and
    // SELECT FOR UPDATE. READ COMMITTED sees commits made while acquiring locks.
    await client.query(`LOCK TABLE ${protectedTables.join(", ")} IN EXCLUSIVE MODE`);
    const before = (await client.query(countSql)).rows[0];
    if (!before || Object.values(before).some(n => n !== "0")) fail("INITIAL_IMPORT_TABLES_NOT_EMPTY");
    const triggers = (await client.query(`SELECT c.relname AS table_name,t.tgname,t.tgenabled
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal`,
    [protectedTables.map(t => t.slice(7))])).rows;
    const required = {
      shopify_variant_catalog: ["mapping_catalog_identity_changed", "mapping_catalog_key_immutable"],
      supplier_mapping_decisions: ["mapping_source_immutable", "mapping_validate_revision", "mapping_decision_no_truncate"],
      supplier_mapping_audit_events: ["mapping_audit_append_only", "mapping_audit_no_truncate"],
      supplier_mapping_hold_resolutions: ["mapping_resolution_append_only", "mapping_resolution_no_truncate", "mapping_validate_resolution"],
    };
    for (const [table, names] of Object.entries(required)) for (const name of names) {
      if (!triggers.some(t => t.table_name === table && t.tgname === name && t.tgenabled === "O")) {
        fail("IMPORT_PROTECTION_TRIGGER_UNAVAILABLE");
      }
    }
    revalidate();
    const columns = ["shop_domain", "variant_gid", "product_gid", "inventory_item_gid", "sku", "title",
      "vendor", "selected_options", "identity_fingerprint", "live_verified_at", "active"] as const;
    let inserted = 0;
    for (let offset = 0; offset < state.rows.length; offset += 500) {
      if (state.policy.signal?.aborted) fail("IMPORT_ABORTED");
      const batch = state.rows.slice(offset, offset + 500);
      const values: unknown[] = [];
      const tuples = batch.map(row => "(" + columns.map(column => {
        values.push(column === "selected_options" ? JSON.stringify(row[column]) : row[column]);
        return `$${values.length}${column === "selected_options" ? "::jsonb" : ""}`;
      }).join(",") + ")").join(",");
      const result = await client.query(
        `INSERT INTO public.shopify_variant_catalog (${columns.join(",")}) VALUES ${tuples}`, values,
      );
      if (result.rowCount !== batch.length) fail("IMPORT_INSERT_COUNT_MISMATCH");
      inserted += batch.length;
    }
    const after = (await client.query(countSql)).rows[0];
    if (inserted !== plan.variantCount || after?.catalog !== String(plan.variantCount)
      || after.decisions !== "0" || after.audits !== "0" || after.resolutions !== "0") fail("IMPORT_FINAL_COUNTS_MISMATCH");
    if (state.policy.signal?.aborted) fail("IMPORT_ABORTED");
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    // Counts alone do not prove field preservation. Read back exact values in
    // bounded batches, after deferred triggers, while all write locks remain.
    for (let offset = 0; offset < state.rows.length; offset += 500) {
      if (state.policy.signal?.aborted) fail("IMPORT_ABORTED");
      const batch = state.rows.slice(offset, offset + 500);
      const actual = (await client.query(
        `SELECT ${columns.join(",")} FROM public.shopify_variant_catalog
         WHERE shop_domain=$1 AND variant_gid=ANY($2::text[])`,
        [plan.shopDomain, batch.map(row => row.variant_gid)],
      )).rows;
      if (actual.length !== batch.length) fail("IMPORT_READBACK_MISMATCH");
      const byId = new Map(actual.map(row => [row.variant_gid, row]));
      for (const expected of batch) {
        const row = byId.get(expected.variant_gid);
        if (!row) fail("IMPORT_READBACK_MISMATCH");
        for (const column of columns) {
          const matches = column === "live_verified_at"
            ? new Date(row![column] as string | Date).getTime() === Date.parse(expected[column])
            : isDeepStrictEqual(row![column], expected[column]);
          if (!matches) fail("IMPORT_READBACK_MISMATCH");
        }
      }
    }
    const final = (await client.query(countSql)).rows[0];
    if (final?.catalog !== String(plan.variantCount) || final.decisions !== "0"
      || final.audits !== "0" || final.resolutions !== "0") fail("IMPORT_FINAL_COUNTS_MISMATCH");
    revalidate();
    commitAttempted = true;
    await client.query("COMMIT");
    begun = false;
    return { runId: plan.runId, inserted, manifestReference: approval.manifestReference, manifestSha256: plan.manifestSha256 };
  } catch (error) {
    if (begun) {
      try { await client.query("ROLLBACK"); } catch { destroy = true; }
    } else destroy = true;
    // A lost COMMIT acknowledgement cannot truthfully be reported as rollback.
    // Do not retry: reconcile the exact manifest against DB state first.
    if (commitAttempted) { destroy = true; return fail("IMPORT_COMMIT_OUTCOME_UNKNOWN"); }
    if (destroy) return fail("IMPORT_RECOVERY_REQUIRED");
    if (error instanceof CatalogImportError) throw error;
    const code = (error as { code?: unknown } | null)?.code;
    return fail(`IMPORT_FAILED_${typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? code : "DATABASE_ERROR"}`);
  } finally { client.release(destroy); }
}
