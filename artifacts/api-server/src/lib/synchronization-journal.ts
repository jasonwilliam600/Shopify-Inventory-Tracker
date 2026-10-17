/**
 * Production-capable journal using the existing PostgreSQL infrastructure.
 * Requires separately approved additive SQL. Never migrates or connects on load.
 * Uncertain outcomes keep a durable store/location lease, including after restart.
 */
import { randomUUID } from "node:crypto";
import type { ImportPool } from "./shopify-catalog-importer";
import { assertGeneratedSyncPlan, digest } from "./synchronization-plan";
import type { SyncPlan } from "./synchronization-types";
import type { SyncJournal } from "./synchronization-executor";
const fail = (code: string): never => { throw new Error(code); };

export class PostgresSyncJournal implements SyncJournal {
  constructor(private readonly pool: ImportPool) {}
  async reserve(plan: SyncPlan, approval: { reviewerId: string }): Promise<Awaited<ReturnType<SyncJournal["reserve"]>>> {
    assertGeneratedSyncPlan(plan);
    if (!approval.reviewerId.trim()) fail("SYNC_JOURNAL_REVIEWER_REQUIRED");
    const locations = [...new Set(plan.operations.map(o => o.locationId))];
    if (locations.length !== 1) fail("SYNC_JOURNAL_REQUIRES_ONE_LOCATION");
    const client = await this.pool.connect();
    let attemptedCommit = false, destroy = false;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query(`INSERT INTO public.shopify_sync_runs
        (run_id,shop_domain,location_gid,plan_digest,plan_document,approved_by,operation_count)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
      [plan.runId, plan.shopDomain, locations[0], plan.digest, JSON.stringify(plan), approval.reviewerId, plan.operations.length]);
      attemptedCommit = true;
      await client.query("COMMIT");
    } catch {
      try { await client.query("ROLLBACK"); } catch { destroy = true; }
      destroy ||= attemptedCommit;
      return fail(attemptedCommit ? "SYNC_RESERVATION_OUTCOME_UNKNOWN" : "SYNC_LOCATION_OR_RUN_ALREADY_RESERVED");
    } finally { client.release(destroy); }
    let released = false;
    return {
      append: async event => {
        if (released) fail("SYNC_JOURNAL_SESSION_CLOSED");
        const c = await this.pool.connect();
        let commit = false, damaged = false;
        try {
          await c.query("BEGIN");
          await c.query("SET LOCAL lock_timeout = '2s'");
          const row = (await c.query(`SELECT state,confirmed_count,last_operation_id
            FROM public.shopify_sync_runs WHERE run_id=$1 AND plan_digest=$2 FOR UPDATE`, [plan.runId, plan.digest])).rows[0];
          if (!row || ["complete", "precondition_failed"].includes(String(row.state))) fail("SYNC_JOURNAL_TERMINAL_RUN");
          let confirmed = Number(row.confirmed_count), last = row.last_operation_id;
          if (event.state === "intent") {
            if (last !== null || confirmed >= plan.operations.length || event.operationId !== digest({
              plan: plan.digest, index: confirmed, op: plan.operations[confirmed],
            })) fail("SYNC_JOURNAL_INVALID_INTENT");
            last = event.operationId;
          } else if (event.state === "confirmed") {
            if (!last || last !== event.operationId) fail("SYNC_JOURNAL_INVALID_CONFIRMATION");
            confirmed++; last = null;
          } else if (event.state === "complete") {
            if (confirmed !== plan.operations.length || last !== null) fail("SYNC_JOURNAL_INCOMPLETE_RUN");
          } else if (event.state === "precondition_failed") {
            if (confirmed !== 0 || last !== null) fail("SYNC_JOURNAL_REVIEW_REQUIRED");
          } else if (event.state !== "outcome_unknown") fail("SYNC_JOURNAL_INVALID_EVENT");
          const state = event.state === "intent" || event.state === "confirmed" ? "writing" : event.state;
          await c.query(`INSERT INTO public.shopify_sync_events (event_id,run_id,state,operation_id)
            VALUES ($1,$2,$3,$4)`, [randomUUID(), plan.runId, event.state, event.operationId ?? null]);
          await c.query(`UPDATE public.shopify_sync_runs SET state=$2,confirmed_count=$3,last_operation_id=$4,updated_at=now()
            WHERE run_id=$1`, [plan.runId, state, confirmed, last]);
          commit = true;
          await c.query("COMMIT");
          commit = false;
        } catch {
          try { await c.query("ROLLBACK"); } catch { damaged = true; }
          return fail("SYNC_JOURNAL_WRITE_FAILED");
        } finally { c.release(damaged || commit); }
      },
      release: async () => {
        const c = await this.pool.connect();
        try {
          const row = (await c.query("SELECT state FROM public.shopify_sync_runs WHERE run_id=$1", [plan.runId])).rows[0];
          if (!row || !["complete", "precondition_failed"].includes(String(row.state))) fail("SYNC_RUN_REQUIRES_RECONCILIATION");
          released = true; // partial unique index releases only durable terminal states
        } finally { c.release(); }
      },
    };
  }
}
