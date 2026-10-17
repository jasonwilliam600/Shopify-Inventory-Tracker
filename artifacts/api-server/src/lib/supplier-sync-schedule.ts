/**
 * One serialized publisher loop; never fetches supplier feeds or replaces their
 * existing schedules. Inert until a trusted reviewer approves exact activation.
 */
import { digest } from "./synchronization-plan";
import { SYNC_SUPPLIERS, type SyncPlan } from "./synchronization-types";
import type { SyncExecutionGrant } from "./synchronization-executor";
export interface SyncScheduleScope {
  shopDomain: string;
  policyDigest: string;
  variantIds: string[];
  intervalMs: number;
  expiresAt: string;
}
interface Ports {
  verifyActivation(input: { action: "activate_supplier_sync"; scope: SyncScheduleScope; evidence: unknown }): Promise<{ reviewerId: string }>;
  dryRun(): Promise<SyncPlan>;
  /** Must validate the approved recurring scope, then issue an exact per-run
   * execution grant through the trusted server-side authorization service. */
  authorizeScopedPlan(plan: SyncPlan, activation: { scope: SyncScheduleScope; reviewerId: string }): Promise<SyncExecutionGrant>;
  execute(plan: SyncPlan, grant: SyncExecutionGrant): Promise<unknown>;
  now?: () => number;
  setTimer?: (callback: () => void, milliseconds: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}
export class SupplierSyncSchedule {
  #scope: SyncScheduleScope | null = null;
  #reviewerId: string | null = null;
  #timer: unknown;
  #busy = false;
  #activating = false;
  #lastError: string | null = null;
  #generation = 0;
  constructor(private readonly ports: Ports) {}
  status() { return { enabled: this.#scope !== null, busy: this.#busy, lastError: this.#lastError,
    suppliers: [...SYNC_SUPPLIERS], activationDigest: this.#scope ? digest(this.#scope) : null }; }
  stop(): void {
    this.#generation++;
    if (this.#timer !== undefined) (this.ports.clearTimer ?? (h => clearTimeout(h as NodeJS.Timeout)))(this.#timer);
    this.#timer = undefined; this.#scope = null; this.#reviewerId = null;
  }
  async activateExplicitlyApproved(scope: SyncScheduleScope, evidence: unknown): Promise<void> {
    if (this.#scope || this.#busy || this.#activating || !/^[a-f0-9]{64}$/.test(scope.policyDigest)
      || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(scope.shopDomain)
      || !Number.isSafeInteger(scope.intervalMs) || scope.intervalMs < 60000 || scope.intervalMs > 3600000
      || !Number.isFinite(Date.parse(scope.expiresAt)) || Date.parse(scope.expiresAt) <= (this.ports.now?.() ?? Date.now())
      || !scope.variantIds.length || new Set(scope.variantIds).size !== scope.variantIds.length
      || scope.variantIds.some(id => !/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/.test(id))) throw new Error("INVALID_SYNC_ACTIVATION_SCOPE");
    const copy = structuredClone(scope), generation = this.#generation;
    this.#activating = true;
    try {
      const actor = await this.ports.verifyActivation({ action: "activate_supplier_sync", scope: structuredClone(copy), evidence });
      if (!actor.reviewerId?.trim()) throw new Error("SYNC_REVIEWER_REQUIRED");
      if (generation !== this.#generation) throw new Error("SYNC_ACTIVATION_CANCELLED");
      this.#scope = copy; this.#reviewerId = actor.reviewerId; this.#lastError = null;
      this.#arm(generation);
    } finally { this.#activating = false; }
  }
  #arm(generation: number) {
    if (!this.#scope || generation !== this.#generation) return;
    const timer = this.ports.setTimer ?? ((f, ms) => setTimeout(f, ms));
    this.#timer = timer(() => { void this.#tick(generation); }, this.#scope.intervalMs);
  }
  async #tick(generation: number): Promise<void> {
    if (!this.#scope || this.#busy || generation !== this.#generation) return;
    this.#busy = true;
    try {
      const scope = this.#scope, actor = this.#reviewerId!;
      if ((this.ports.now?.() ?? Date.now()) >= Date.parse(scope.expiresAt)) throw new Error("SYNC_ACTIVATION_EXPIRED");
      const plan = await this.ports.dryRun();
      if (!this.#scope || generation !== this.#generation) return;
      if (plan.shopDomain !== scope.shopDomain || plan.policyDigest !== scope.policyDigest || plan.blockers.length
        || plan.operations.some(op => !scope.variantIds.includes(op.variantId))) throw new Error("SYNC_PLAN_OUTSIDE_APPROVED_ACTIVATION");
      if (plan.operations.length) {
        const grant = await this.ports.authorizeScopedPlan(plan, { scope: structuredClone(scope), reviewerId: actor });
        if (!this.#scope || generation !== this.#generation) return;
        await this.ports.execute(plan, grant);
      }
    } catch {
      this.#lastError = "SCHEDULE_STOPPED_REVIEW_REQUIRED";
      this.stop(); // no blind repeated bulk attempt on auth/transport/journal uncertainty
    } finally {
      this.#busy = false;
      this.#arm(generation);
    }
  }
}
