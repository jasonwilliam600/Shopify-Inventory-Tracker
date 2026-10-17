/**
 * Guarded, transport-independent execution. No Shopify auth/fetch/SDK, default
 * journal, DB connection, scheduler or live adapter. Owner authorization required.
 */
import { assertGeneratedSyncPlan, digest } from "./synchronization-plan";
import { mappingHold } from "./supplier-mapping-policy";
import type { SyncPlan, SyncOperation } from "./synchronization-types";

export interface SyncPrecondition {
  shopDomain: string; currency: string; identityFingerprint: string;
  mappingStillApproved: boolean; mappingRevision: number; sourceFingerprint: string;
  scopesVerified: boolean; locationId: string; locationActive: boolean; tracked: boolean;
  committedQuantity: number;
  value: number | string;
}
export interface SyncTransport {
  /** Must freshly verify shop, scopes, location, source + mapping, and Shopify baseline. */
  readPrecondition(operation: SyncOperation): Promise<SyncPrecondition>;
  /** Inventory uses compareQuantity, not ignoreCompareQuantity. One target per call.
   * Price requests must refuse partial updates. No product creation or activation. */
  apply(operation: SyncOperation, context: { operationId: string; requireCompareQuantity: true }): Promise<{ accepted: boolean }>;
  readValue(operation: SyncOperation): Promise<number | string>;
}
export interface SyncJournal {
  /** Durable atomic shop/location lease + create-only run reservation.
   * Uncertain runs retain their lease across process recreation. */
  reserve(plan: SyncPlan, approval: { reviewerId: string }): Promise<{
    append(event: { operationId?: string; state: "intent" | "confirmed" | "complete" | "outcome_unknown" | "precondition_failed" }): Promise<void>;
    release(): Promise<void>;
  }>;
}
export interface OwnerApprovalPort {
  /** Trusted server-side reviewer identity/role check; never a client boolean. */
  verify(input: { action: "execute_sync_plan"; planDigest: string; shopDomain: string;
    operations: readonly SyncOperation[]; evidence: unknown }): Promise<{ reviewerId: string }>;
}
export interface SyncExecutionGrant { readonly opaque: true }
const fail = (code: string): never => { throw new Error(code); };
export class SynchronizationExecutor {
  readonly #grants = new WeakMap<SyncExecutionGrant, { digest: string; used: boolean; reviewerId: string }>();
  #busy = false;
  #stopped = false;
  constructor(private readonly ports: { transport: SyncTransport; journal: SyncJournal; authorization: OwnerApprovalPort;
    now?: () => number; readRetry?: { maxAttempts: number; sleep: (ms: number) => Promise<void> } }) {}
  stop(): void { this.#stopped = true; }
  status() { return { stopped: this.#stopped, busy: this.#busy, automaticSynchronizationEnabled: false as const }; }
  async authorizeExactPlan(plan: SyncPlan, evidence: unknown): Promise<SyncExecutionGrant> {
    this.#check(plan);
    const verified = await this.ports.authorization.verify({ action: "execute_sync_plan", planDigest: plan.digest,
      shopDomain: plan.shopDomain, operations: plan.operations, evidence });
    if (!verified.reviewerId?.trim()) fail("SYNC_REVIEWER_REQUIRED");
    const grant = Object.freeze({ opaque: true as const });
    this.#grants.set(grant, { digest: plan.digest, used: false, reviewerId: verified.reviewerId });
    return grant;
  }
  #check(plan: SyncPlan): void {
    assertGeneratedSyncPlan(plan);
    const now = this.ports.now?.() ?? Date.now();
    if (this.#stopped || plan.blockers.length || !Number.isFinite(now)
      || now < Date.parse(plan.createdAt) || now >= Date.parse(plan.expiresAt)) fail("SYNC_PLAN_BLOCKED_OR_EXPIRED");
  }
  async #read<T>(fn: () => Promise<T>, plan: SyncPlan): Promise<T> {
    const retry = this.ports.readRetry;
    const attempts = retry?.maxAttempts ?? 1;
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 3) fail("INVALID_SYNC_RETRY_POLICY");
    for (let n = 0; n < attempts; n++) {
      this.#check(plan);
      try { return await fn(); } catch {
        if (n === attempts - 1) return fail("SYNC_READ_FAILED");
        await retry!.sleep(Math.min(2000, 250 * 2 ** n));
      }
    }
    return fail("SYNC_READ_FAILED");
  }
  async executeExactPlan(plan: SyncPlan, grant: SyncExecutionGrant): Promise<{ runId: string; confirmed: number }> {
    this.#check(plan);
    const authorization = this.#grants.get(grant);
    if (!authorization || authorization.digest !== plan.digest || authorization.used) return fail("SYNC_EXACT_OWNER_APPROVAL_REQUIRED");
    if (this.#busy) fail("SYNC_WORKER_ALREADY_RUNNING");
    if (!plan.operations.length) {
      authorization.used = true;
      return { runId: plan.runId, confirmed: 0 };
    }
    this.#busy = true;
    authorization.used = true;
    let session: Awaited<ReturnType<SyncJournal["reserve"]>> | undefined, attemptedWrite = false, confirmed = 0;
    try {
      session = await this.ports.journal.reserve(plan, { reviewerId: authorization.reviewerId });
      // Check the entire plan before the first write; then again per operation.
      for (const op of plan.operations) await this.#precondition(plan, op);
      for (let index = 0; index < plan.operations.length; index++) {
        const op = plan.operations[index], operationId = digest({ plan: plan.digest, index, op });
        await this.#precondition(plan, op);
        await session.append({ operationId, state: "intent" }); // durable BEFORE side effect
        this.#check(plan);
        attemptedWrite = true;
        // NEVER blindly retry a write, even when the transport reports a timeout.
        const result = await this.ports.transport.apply(op, { operationId, requireCompareQuantity: true });
        if (result.accepted !== true) fail("SYNC_WRITE_REJECTED");
        const observed = await this.#read(() => this.ports.transport.readValue(op), plan);
        if (observed !== op.after) fail("SYNC_READBACK_MISMATCH");
        await session.append({ operationId, state: "confirmed" });
        confirmed++;
      }
      await session.append({ state: "complete" });
      await session.release();
      return { runId: plan.runId, confirmed };
    } catch {
      if (session) {
        try {
          await session.append({ state: attemptedWrite ? "outcome_unknown" : "precondition_failed" });
          if (!attemptedWrite) await session.release();
        } catch { /* retain durable lease on journal uncertainty */ }
      }
      if (attemptedWrite) this.#stopped = true;
      return fail(attemptedWrite ? "SYNC_OUTCOME_REQUIRES_RECONCILIATION" : "SYNC_PREFLIGHT_OR_JOURNAL_FAILED");
    } finally { this.#busy = false; }
  }
  async #precondition(plan: SyncPlan, op: SyncOperation): Promise<void> {
    this.#check(plan);
    if (mappingHold(op.supplier, op.originalSku)) fail("SYNC_SOURCE_HOLD_ACTIVE");
    const p = await this.#read(() => this.ports.transport.readPrecondition(op), plan);
    if (p.shopDomain !== plan.shopDomain || p.currency !== "USD" || !p.mappingStillApproved
      || p.mappingRevision !== op.mappingRevision || p.sourceFingerprint !== op.sourceFingerprint
      || p.identityFingerprint !== op.identityFingerprint || !p.scopesVerified || !p.locationActive
      || !p.tracked || p.locationId !== op.locationId || p.value !== op.before
      || op.field === "inventory" && p.committedQuantity !== op.committedQuantity) fail("SYNC_PRECONDITION_CHANGED");
  }
}
