/** Shared runtime composition, installed in Express locals.
 * No default ports, filesystem paths, timers, credentials or side effects.
 * All four existing supplier refresh schedules remain owned by their adapters. */
import { CatalogLifecycle } from "./catalog-lifecycle";
import { buildSyncPlan } from "./synchronization-plan";
import { SynchronizationExecutor, type SyncExecutionGrant } from "./synchronization-executor";
import { SYNC_SUPPLIERS, type SyncSupplier, type SyncPlan } from "./synchronization-types";
import { SupplierSyncSchedule } from "./supplier-sync-schedule";
import { SUPPLIER_METAFIELD_DEFINITIONS, SUPPLIER_METAFIELD_KEYS } from "./supplier-variant-metafields";

type PlanInput = Parameters<typeof buildSyncPlan>[0];
type ExecutionPorts = ConstructorParameters<typeof SynchronizationExecutor>[0];
export class ApplicationSynchronization {
  supplierMetafieldConfigurationPlan() {
    return { definitions: SUPPLIER_METAFIELD_DEFINITIONS, pinKeys: SUPPLIER_METAFIELD_KEYS.slice(1),
      requiresOwnerApproval: true as const, writesEnabled: false as const };
  }
  readonly catalog = new CatalogLifecycle();
  #loader: (() => Promise<PlanInput>) | null = null;
  #executor: SynchronizationExecutor | null = null;
  #lastPlan: SyncPlan | null = null;
  #schedule: SupplierSyncSchedule | null = null;
  #feeds = new Map<SyncSupplier, string>();
  configureReadOnlyPlanning(loader: () => Promise<PlanInput>): void { this.#loader = loader; }
  configureControlledExecution(ports: ExecutionPorts): void {
    if (this.#executor) throw new Error("SYNC_EXECUTOR_ALREADY_CONFIGURED");
    this.#executor = new SynchronizationExecutor(ports);
  }
  configureApprovedSchedulePorts(ports: ConstructorParameters<typeof SupplierSyncSchedule>[0]): SupplierSyncSchedule {
    if (this.#schedule) throw new Error("SYNC_SCHEDULE_ALREADY_CONFIGURED");
    this.#schedule = new SupplierSyncSchedule(ports); // inert; does NOT activate
    return this.#schedule;
  }
  notifySuccessfulSupplierRefresh(supplier: SyncSupplier, completedAt: string): void {
    if (!SYNC_SUPPLIERS.includes(supplier) || !Number.isFinite(Date.parse(completedAt))) throw new Error("INVALID_SUPPLIER_REFRESH_EVENT");
    this.#feeds.set(supplier, completedAt);
    // Does not trigger an import/write/timer. Activation requires separate approval.
  }
  async dryRun(): Promise<SyncPlan> {
    if (!this.#loader) throw new Error("SYNC_READ_ONLY_SOURCE_NOT_CONFIGURED");
    const input = await this.#loader();
    this.#lastPlan = buildSyncPlan(input);
    return this.#lastPlan;
  }
  async authorizeExactPlan(plan: SyncPlan, evidence: unknown): Promise<SyncExecutionGrant> {
    if (!this.#executor) throw new Error("SYNC_AUTHORIZED_EXECUTION_PATH_NOT_CONFIGURED");
    return this.#executor.authorizeExactPlan(plan, evidence);
  }
  async executeExplicitlyApprovedPlan(plan: SyncPlan, approval: SyncExecutionGrant) {
    if (!this.#executor) throw new Error("SYNC_AUTHORIZED_EXECUTION_PATH_NOT_CONFIGURED");
    return this.#executor.executeExactPlan(plan, approval);
  }
  stop(): void { this.#schedule?.stop(); this.#executor?.stop(); }
  status() {
    return { catalog: this.catalog.status(), sourceConfigured: this.#loader !== null,
      executionConfigured: this.#executor !== null, automaticSynchronizationEnabled: this.#schedule?.status().enabled ?? false,
      lastDryRun: this.#lastPlan ? { digest: this.#lastPlan.digest, summary: this.#lastPlan.summary, blockers: this.#lastPlan.blockers } : null,
      suppliers: SYNC_SUPPLIERS.map(supplier => ({ supplier, lastSuccessfulRefresh: this.#feeds.get(supplier) ?? null })),
      execution: this.#executor?.status() ?? null };
  }
}
