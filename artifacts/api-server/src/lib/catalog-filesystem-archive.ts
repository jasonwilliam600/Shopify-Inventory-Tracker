/**
 * UNCONNECTED, DEVELOPMENT-ONLY archive. No default paths/key, routes, startup,
 * environment credentials, database connection, Shopify calls or import command.
 */
import * as fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { initialCatalogManifest, type InitialCatalogPlan, type ProtectedManifestArchive } from "./shopify-catalog-importer";
import { checkPrivateRoot, createPrivateRoot, readPrivate, writeImmutable, sha256, fail, requireDevelopmentRuntime } from "../../../../scripts/catalog-archive/secure-fs.mjs";
import { seal, open, keyId, UUID, HASH, makeBackup, verifyRestoreReceipt,
  type RestoreReceipt, type BackupPayload } from "../../../../scripts/catalog-archive/format.mjs";

interface Options {
  environment: "development";
  root: string;
  workspaceRoot: string;
  /** Include any additional served/build/export roots outside the workspace. */
  forbiddenRoots: string[];
  key: Uint8Array;
}
export interface FilesystemArchiveReceipt {
  reference: string; sha256: string; bytes: number;
}
function development(options: Options): void {
  if (options.environment !== "development") fail("ARCHIVE_DEVELOPMENT_ONLY");
  requireDevelopmentRuntime();
  if (!(options.key instanceof Uint8Array) || options.key.length !== 32) fail("ARCHIVE_KEY_REQUIRED");
  if (!path.isAbsolute(options.workspaceRoot) || !Array.isArray(options.forbiddenRoots)) fail("ARCHIVE_WORKSPACE_BOUNDARY_REQUIRED");
}
export class CatalogFilesystemArchive implements ProtectedManifestArchive {
  readonly #key: Buffer;
  readonly #options: Options;
  readonly #identity: { dev: number; ino: number };
  private constructor(options: Options, identity: { dev: number; ino: number }) {
    this.#key = Buffer.from(options.key);
    this.#options = { ...options, key: this.#key, forbiddenRoots: [...options.forbiddenRoots] };
    this.#identity = identity;
  }
  static async create(options: Options): Promise<CatalogFilesystemArchive> {
    development(options);
    const identity = await createPrivateRoot(options.root, [options.workspaceRoot, ...options.forbiddenRoots]);
    return new CatalogFilesystemArchive(options, identity);
  }
  static async open(options: Options): Promise<CatalogFilesystemArchive> {
    development(options);
    const identity = await checkPrivateRoot(options.root, [options.workspaceRoot, ...options.forbiddenRoots]);
    return new CatalogFilesystemArchive(options, identity);
  }
  destroy(): void { this.#key.fill(0); }
  async #guard(): Promise<void> {
    development(this.#options);
    if (this.#key.every(b => b === 0)) fail("ARCHIVE_KEY_DESTROYED");
    const current = await checkPrivateRoot(this.#options.root, [this.#options.workspaceRoot, ...this.#options.forbiddenRoots]);
    if (current.dev !== this.#identity.dev || current.ino !== this.#identity.ino) fail("ARCHIVE_ROOT_REPLACED");
  }
  #name(runId: string, slot: string): string {
    if (!UUID.test(runId) || !/^(manifest|source|provenance|(outcome|verified|export)-[a-f0-9-]{36})$/.test(slot)) fail("ARCHIVE_INVALID_REFERENCE");
    return `${runId}.${slot}.enc`;
  }
  async #encrypted(runId: string, slot: string): Promise<Buffer> {
    await this.#guard();
    const result = await readPrivate(this.#options.root, this.#name(runId, slot));
    await this.#guard();
    return result;
  }
  async #read(runId: string, slot: string): Promise<Buffer> {
    return open(await this.#encrypted(runId, slot), this.#key, { runId, slot, keyId: keyId(this.#key) });
  }
  async #put(runId: string, slot: string, bytes: Uint8Array): Promise<FilesystemArchiveReceipt> {
    await this.#guard();
    const name = this.#name(runId, slot), digest = sha256(bytes);
    try {
      const existing = await this.#read(runId, slot);
      if (sha256(existing) !== digest) fail("ARCHIVE_IMMUTABILITY_CONFLICT");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      try {
        await writeImmutable(this.#options.root, name,
          seal(bytes, this.#key, { runId, slot, keyId: keyId(this.#key) }));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (sha256(await this.#read(runId, slot)) !== digest) fail("ARCHIVE_IMMUTABILITY_CONFLICT");
      }
    }
    if (sha256(await this.#read(runId, slot)) !== digest) fail("ARCHIVE_WRITE_READBACK_FAILED");
    await this.#guard();
    return { reference: `private-${slot}:${runId}`, sha256: digest, bytes: bytes.length };
  }
  async archiveManifest(plan: InitialCatalogPlan): Promise<FilesystemArchiveReceipt> {
    const bytes = initialCatalogManifest(plan); // preserves the existing opaque-plan gate
    if (bytes.length !== plan.manifestBytes || sha256(bytes) !== plan.manifestSha256) fail("ARCHIVE_PLAN_MISMATCH");
    return this.#put(plan.runId, "manifest", bytes);
  }
  async archiveSource(runId: string, bytes: Uint8Array): Promise<FilesystemArchiveReceipt> {
    return this.#put(runId, "source", bytes);
  }
  async archiveProvenance(runId: string, bytes: Uint8Array): Promise<FilesystemArchiveReceipt> {
    return this.#put(runId, "provenance", bytes);
  }
  async appendOutcome(input: { runId: string; eventId: string; state: "prepared" | "committed" | "rolled_back" | "outcome_unknown";
    occurredAt: string; manifestSha256: string }): Promise<FilesystemArchiveReceipt> {
    if (!UUID.test(input.eventId) || !["prepared", "committed", "rolled_back", "outcome_unknown"].includes(input.state)
      || !HASH.test(input.manifestSha256) || !Number.isFinite(Date.parse(input.occurredAt))) fail("ARCHIVE_OUTCOME_INVALID");
    return this.#put(input.runId, `outcome-${input.eventId}`, Buffer.from(JSON.stringify({
      kind: "tsh-catalog-import-outcome-v1", runId: input.runId, eventId: input.eventId,
      state: input.state, occurredAt: input.occurredAt, manifestSha256: input.manifestSha256,
    }) + "\n"));
  }
  async #records(runId: string): Promise<{ slot: string; encrypted: Buffer }[]> {
    if (!UUID.test(runId)) fail("ARCHIVE_INVALID_REFERENCE");
    await this.#guard();
    const names = (await fs.readdir(this.#options.root)).filter(n => n.startsWith(`${runId}.`)
      && /[.](manifest|source|provenance|outcome-[a-f0-9-]{36})[.]enc$/.test(n)).sort();
    if (names.length > 10000) fail("ARCHIVE_RECORD_LIMIT");
    return Promise.all(names.map(async name => {
      const slot = name.slice(runId.length + 1, -4);
      return { slot, encrypted: await this.#encrypted(runId, slot) };
    }));
  }
  async exportEncryptedBackup(runId: string, passphrase: string): Promise<{
    backupId: string; filename: string; backupSha256: string; manifestSha256: string; bytes: number;
  }> {
    const manifest = await this.#read(runId, "manifest"), source = await this.#read(runId, "source");
    await this.#read(runId, "provenance");
    const m = JSON.parse(manifest.toString("utf8"));
    if (m.kind !== "tsh-initial-catalog-import-v1" || m.runId !== runId || m.receipt?.downloadSha256 !== sha256(source)) fail("ARCHIVE_SOURCE_MISMATCH");
    const backupId = randomUUID(), manifestSha256 = sha256(manifest);
    const records = await this.#records(runId);
    const payload: BackupPayload = { kind: "tsh-private-backup-v1", runId, backupId, archiveKey: this.#key.toString("base64"),
      challenge: randomBytes(32).toString("hex"), manifestSha256,
      records: records.map(r => ({ slot: r.slot, encrypted: r.encrypted.toString("base64") })) };
    const bytes = await makeBackup(payload, passphrase), filename = `${runId}.backup-${backupId}.tshbackup`;
    await this.#guard(); await writeImmutable(this.#options.root, filename, bytes); await this.#guard();
    await this.#put(runId, `export-${backupId}`, Buffer.from(JSON.stringify({
      kind: "tsh-backup-binding-v1", challenge: payload.challenge, backupSha256: sha256(bytes), manifestSha256,
      records: records.map(r => ({ slot: r.slot, sha256: sha256(r.encrypted) })),
    })));
    return { backupId, filename, backupSha256: sha256(bytes), manifestSha256, bytes: bytes.length };
  }
  /**
   * Explicit human acknowledgement is essential: a MAC proves possession of the
   * restored backup, NOT the physical identity/location of another computer.
   */
  async acceptIndependentRestore(input: { receipt: RestoreReceipt; backupFilename: string;
    confirmedIndependentRestore: true }): Promise<void> {
    await this.#guard();
    if (input.confirmedIndependentRestore !== true) fail("BACKUP_OPERATOR_CONFIRMATION_REQUIRED");
    const r = input.receipt;
    if (!UUID.test(r.runId) || !UUID.test(r.backupId) || !Number.isSafeInteger(r.objectCount) || r.objectCount < 3 || r.objectCount > 10000
      || input.backupFilename !== `${r.runId}.backup-${r.backupId}.tshbackup`) fail("BACKUP_RECEIPT_INVALID");
    // The receipt is authenticated against the archive key. The independent tool
    // can obtain that key only by decrypting the passphrase-protected backup.
    if (sha256(await readPrivate(this.#options.root, input.backupFilename)) !== r.backupSha256
      || sha256(await this.#read(r.runId, "manifest")) !== r.manifestSha256) fail("BACKUP_RECEIPT_MISMATCH");
    // Bind the receipt challenge and exact record set to the exported package.
    const exportedBinding = await this.#read(r.runId, `export-${r.backupId}`).catch(() => null);
    if (!exportedBinding) fail("BACKUP_EXPORT_BINDING_MISSING");
    const binding = JSON.parse(exportedBinding.toString("utf8"));
    if (binding.kind !== "tsh-backup-binding-v1" || binding.challenge !== r.challenge
      || binding.backupSha256 !== r.backupSha256 || binding.manifestSha256 !== r.manifestSha256
      || binding.records.length !== r.objectCount) fail("BACKUP_RECEIPT_MISMATCH");
    verifyRestoreReceipt(r, { runId: r.runId, backupId: r.backupId, backupSha256: r.backupSha256,
      manifestSha256: r.manifestSha256, challenge: r.challenge, records: binding.records, archiveKey: this.#key });
    await this.#put(r.runId, `verified-${r.backupId}`, Buffer.from(JSON.stringify({
      kind: "tsh-accepted-independent-backup-v1", confirmedByOperator: true, receipt: r, records: binding.records,
    })));
  }
  async readManifest(reference: string): Promise<Uint8Array> {
    const runId = reference.replace(/^private-manifest:/, "");
    if (!UUID.test(runId) || reference !== `private-manifest:${runId}`) fail("ARCHIVE_INVALID_REFERENCE");
    const manifest = await this.#read(runId, "manifest");
    const proofs = (await fs.readdir(this.#options.root)).filter(n => n.startsWith(`${runId}.verified-`) && n.endsWith(".enc"));
    for (const name of proofs) {
      const slot = name.slice(runId.length + 1, -4), accepted = JSON.parse((await this.#read(runId, slot)).toString("utf8"));
      const r = accepted.receipt;
      if (accepted.kind !== "tsh-accepted-independent-backup-v1" || accepted.confirmedByOperator !== true
        || r.runId !== runId || sha256(manifest) !== r.manifestSha256) fail("BACKUP_RECEIPT_MISMATCH");
      verifyRestoreReceipt(r, { runId, backupId: r.backupId, backupSha256: r.backupSha256,
        manifestSha256: r.manifestSha256, challenge: r.challenge, records: accepted.records, archiveKey: this.#key });
      if (sha256(await readPrivate(this.#options.root, `${runId}.backup-${r.backupId}.tshbackup`)) !== r.backupSha256) fail("BACKUP_HASH_MISMATCH");
      for (const record of accepted.records) {
        if (sha256(await this.#encrypted(runId, record.slot)) !== record.sha256) fail("BACKUP_RECORD_CHANGED");
      }
      await this.#guard();
      return Uint8Array.from(manifest);
    }
    return fail("INDEPENDENT_BACKUP_REQUIRED");
  }
}
