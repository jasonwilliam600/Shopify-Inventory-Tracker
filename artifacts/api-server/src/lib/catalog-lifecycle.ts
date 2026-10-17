/**
 * Application-owned catalog lifecycle. No default filesystem/DB/Shopify access.
 * Opening an existing archive is separate from creating it. Real import needs
 * an exact owner approval, verified DB backup and the unchanged importer gates.
 */
import { randomUUID, createHash } from "node:crypto";
import { CatalogFilesystemArchive } from "./catalog-filesystem-archive";
import {
  initialCatalogManifest, importInitialDevelopmentCatalog, prepareInitialCatalogImport,
  type InitialCatalogPlan, type ImportPool, type DevelopmentImportApproval,
} from "./shopify-catalog-importer";

type ArchiveOptions = Parameters<typeof CatalogFilesystemArchive.open>[0];
export interface CatalogBackupEvidence {
  databaseName: string;
  reference: string;
  sha256: string;
  completedAt: string;
  restoreVerifiedAt: string;
}
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const fail = (code: string): never => { throw new Error(code); };
export class CatalogLifecycle {
  #archive: CatalogFilesystemArchive | null = null;
  #outcomeUnknown = false;
  #busy = false;
  status() {
    return Object.freeze({ archiveConnected: this.#archive !== null, busy: this.#busy,
      recoveryRequired: this.#outcomeUnknown, importsAutomaticallyEnabled: false as const });
  }
  /** Opens ONLY an independently provisioned archive; never creates a real key/root. */
  async connectExistingArchive(options: ArchiveOptions): Promise<void> {
    if (this.#busy || this.#archive) fail("CATALOG_ARCHIVE_ALREADY_CONNECTED_OR_BUSY");
    this.#archive = await CatalogFilesystemArchive.open(options);
  }
  prepare(input: Parameters<typeof prepareInitialCatalogImport>[0]) {
    return prepareInitialCatalogImport(input);
  }
  async stageApproved(input: { plan: InitialCatalogPlan; source: Uint8Array; provenance: Uint8Array;
    approvedManifestSha256: string }): Promise<void> {
    if (!this.#archive) fail("CATALOG_ARCHIVE_NOT_CONNECTED");
    if (this.#busy || this.#outcomeUnknown) fail("CATALOG_OPERATION_BLOCKED");
    const manifest = initialCatalogManifest(input.plan);
    if (input.approvedManifestSha256 !== sha(manifest)) fail("CATALOG_STAGE_APPROVAL_MISMATCH");
    const m = JSON.parse(Buffer.from(manifest).toString("utf8"));
    if (sha(input.source) !== m.receipt.downloadSha256) fail("CATALOG_STAGE_SOURCE_MISMATCH");
    this.#busy = true;
    try {
      await this.#archive!.archiveManifest(input.plan);
      await this.#archive!.archiveSource(input.plan.runId, input.source);
      await this.#archive!.archiveProvenance(input.plan.runId, input.provenance);
    } finally { this.#busy = false; }
  }
  /** Archive retains its independent-backup gate. Merely connecting it grants nothing. */
  async readApprovedManifest(reference: string): Promise<Uint8Array> {
    if (!this.#archive) fail("CATALOG_ARCHIVE_NOT_CONNECTED");
    return this.#archive!.readManifest(reference);
  }
  async executeExplicitlyApprovedImport(input: {
    plan: InitialCatalogPlan; approval: DevelopmentImportApproval; pool: ImportPool;
    backup: CatalogBackupEvidence; ownerApproved: true;
  }) {
    if (!this.#archive || this.#busy || this.#outcomeUnknown || input.ownerApproved !== true) fail("CATALOG_OPERATION_BLOCKED");
    const b = input.backup, completed = Date.parse(b.completedAt), restored = Date.parse(b.restoreVerifiedAt);
    if (b.databaseName !== input.approval.expectedDatabaseName || !/^[a-f0-9]{64}$/.test(b.sha256)
      || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(b.reference)
      || !Number.isFinite(completed) || !Number.isFinite(restored)
      || completed > restored || restored > Date.now() || Date.now() - completed > 3600_000) fail("CATALOG_VERIFIED_DATABASE_BACKUP_REQUIRED");
    initialCatalogManifest(input.plan); // reject forged plans before archive writes
    if (input.plan.manifestSha256 !== input.approval.approvedManifestSha256) fail("CATALOG_APPROVAL_MANIFEST_MISMATCH");
    // Avoid recording preparation or connecting a pool until the archive proves
    // actual backup readiness and byte-exact manifest identity.
    this.#busy = true;
    let committed = false, prepared = false;
    try {
      const bytes = await this.#archive!.readManifest(input.approval.manifestReference);
      if (sha(bytes) !== input.approval.approvedManifestSha256) fail("CATALOG_ARCHIVE_MANIFEST_MISMATCH");
      prepared = true;
      await this.#archive!.appendOutcome({ runId: input.plan.runId, eventId: randomUUID(), state: "prepared",
        occurredAt: new Date().toISOString(), manifestSha256: input.plan.manifestSha256 });
      const result = await importInitialDevelopmentCatalog({ ...input, archive: this.#archive! });
      committed = true;
      await this.#archive!.appendOutcome({ runId: input.plan.runId, eventId: randomUUID(), state: "committed",
        occurredAt: new Date().toISOString(), manifestSha256: input.plan.manifestSha256 });
      return result;
    } catch (e) {
      if (!prepared) throw e; // preflight refusal is not a database rollback
      const code = e instanceof Error ? e.message : "CATALOG_FAILURE";
      // Never report a successful DB commit followed by an archive failure as
      // rolled back, and never automatically retry uncertain outcomes.
      this.#outcomeUnknown = committed || /OUTCOME_UNKNOWN|RECOVERY_REQUIRED/.test(code);
      try {
        await this.#archive!.appendOutcome({ runId: input.plan.runId, eventId: randomUUID(),
          state: this.#outcomeUnknown ? "outcome_unknown" : "rolled_back",
          occurredAt: new Date().toISOString(), manifestSha256: input.plan.manifestSha256 });
      } catch { this.#outcomeUnknown = true; }
      throw e;
    } finally { this.#busy = false; }
  }
}
