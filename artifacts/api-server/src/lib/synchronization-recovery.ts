/** Read-only incident inspection followed by a DIFFERENT, explicit owner approval.
 * Resolving a lease never writes Shopify or deletes/rewrites audit events. */
import { randomUUID } from "node:crypto";
import type { ImportPool } from "./shopify-catalog-importer";
import type { SyncOperation } from "./synchronization-types";
import { digest } from "./synchronization-plan";
export interface SyncRecoveryReport {
  runId: string; planDigest: string; inspectedAt: string; digest: string;
  observations: readonly { operationId: string; observed: number | string; before: number | string; after: number | string }[];
}
const reports = new WeakMap<SyncRecoveryReport, { version: string; reportDigest: string }>();
const fail = (code: string): never => { throw new Error(code); };
const version = (row: Record<string, unknown>) => digest({ state: row.state, count: row.confirmed_count,
  last: row.last_operation_id, updatedAt: row.updated_at });
export async function inspectSyncRecovery(input: {
  pool: ImportPool; runId: string;
  readCurrentValue: (operation: SyncOperation) => Promise<number | string>;
}): Promise<SyncRecoveryReport> {
  if (!/^[a-f0-9-]{36}$/.test(input.runId)) fail("INVALID_SYNC_RUN");
  const client = await input.pool.connect();
  let row: Record<string, unknown> | undefined;
  try { row = (await client.query("SELECT * FROM public.shopify_sync_runs WHERE run_id=$1", [input.runId])).rows[0]; }
  finally { client.release(); }
  if (!row || !["reserved", "writing", "outcome_unknown"].includes(String(row.state))) return fail("SYNC_RUN_NOT_RECOVERABLE");
  const plan = row.plan_document as { operations: SyncOperation[]; digest: string };
  const { digest: planDigest, ...body } = plan;
  if (planDigest !== row.plan_digest || digest(body) !== planDigest) fail("SYNC_STORED_PLAN_CORRUPT");
  const observations: SyncRecoveryReport["observations"][number][] = [];
  for (let i = 0; i < plan.operations.length; i++) {
    const op = plan.operations[i], observed = await input.readCurrentValue(op);
    if (typeof observed !== typeof op.before || typeof observed === "number" && !Number.isSafeInteger(observed)) fail("SYNC_RECOVERY_INVALID_OBSERVATION");
    observations.push({ operationId: digest({ plan: planDigest, index: i, op }),
      observed, before: op.before, after: op.after });
  }
  const reportBody = { runId: input.runId, planDigest, inspectedAt: new Date().toISOString(), observations };
  const report = Object.freeze({ ...reportBody, observations: Object.freeze(observations.map(o => Object.freeze(o))),
    digest: digest(reportBody) });
  reports.set(report, { version: version(row), reportDigest: report.digest });
  return report;
}
export async function resolveExplicitlyReviewedSyncRun(input: {
  pool: ImportPool; report: SyncRecoveryReport; evidence: unknown;
  verifyOwner: (input: { action: "resolve_sync_run"; report: SyncRecoveryReport; evidence: unknown }) => Promise<{ reviewerId: string }>;
}): Promise<void> {
  const state = reports.get(input.report), { digest: actual, ...body } = input.report;
  if (!state || actual !== state.reportDigest || digest(body) !== actual
    || Date.now() - Date.parse(input.report.inspectedAt) > 300000) fail("SYNC_RECOVERY_REPORT_INVALID_OR_EXPIRED");
  const actor = await input.verifyOwner({ action: "resolve_sync_run", report: input.report, evidence: input.evidence });
  if (!actor.reviewerId.trim()) fail("SYNC_REVIEWER_REQUIRED");
  const c = await input.pool.connect();
  let commit = false, destroy = false;
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout = '2s'");
    const row = (await c.query("SELECT * FROM public.shopify_sync_runs WHERE run_id=$1 FOR UPDATE", [input.report.runId])).rows[0];
    if (!row || version(row) !== state!.version) fail("SYNC_INCIDENT_CHANGED_SINCE_REVIEW");
    await c.query(`INSERT INTO public.shopify_sync_events (event_id,run_id,state,reviewed_by,details)
      VALUES ($1,$2,'reconciled',$3,$4::jsonb)`,
    [randomUUID(), input.report.runId, actor.reviewerId, JSON.stringify(input.report)]);
    await c.query(`UPDATE public.shopify_sync_runs SET state='reconciled',reconciled_by=$2,
      reconciliation_sha256=$3,updated_at=now() WHERE run_id=$1`,
    [input.report.runId, actor.reviewerId, input.report.digest]);
    commit = true; await c.query("COMMIT"); commit = false;
    reports.delete(input.report); // no replay
  } catch {
    try { await c.query("ROLLBACK"); } catch { destroy = true; }
    return fail("SYNC_RECOVERY_REQUIRES_REVIEW");
  } finally { c.release(destroy || commit); }
}
