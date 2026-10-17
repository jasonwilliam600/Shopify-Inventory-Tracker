/**
 * Private, durable GCS/App Storage archive adapter. No default client, bucket
 * provisioning, credential reads, routes, signed URLs, deletes or background I/O.
 * All operations require an explicitly injected approved private bucket.
 */
import { createHash } from "node:crypto";
import { initialCatalogManifest, type InitialCatalogPlan, type ProtectedManifestArchive } from "./shopify-catalog-importer";

type Metadata = { generation?: string | number; size?: string | number;
  metadata?: Record<string, string>; iamConfiguration?: {
    uniformBucketLevelAccess?: { enabled?: boolean }; publicAccessPrevention?: string;
  } };
interface ArchiveFile {
  save(bytes: Buffer, options: {
    resumable: false; validation: "crc32c"; preconditionOpts: { ifGenerationMatch: 0 };
    metadata: { contentType: string; cacheControl: string; metadata: Record<string, string> };
  }): Promise<unknown>;
  getMetadata(): Promise<[Metadata, ...unknown[]]>;
  download(options: { validation: "crc32c" }): Promise<[Buffer, ...unknown[]]>;
}
/** Structural subset of the Google Cloud Storage SDK; SDK auth stays outside. */
export interface PrivateArchiveBucket {
  name: string;
  getMetadata(): Promise<[Metadata, ...unknown[]]>;
  file(name: string, options?: { generation: string }): ArchiveFile;
}
export interface ArchiveReceipt {
  reference: string; sha256: string; bytes: number; generation: string;
}
const prefix = "tsh-private/catalog-imports/v1";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const limit = 128 * 1024 * 1024;
export class CatalogArchiveError extends Error {
  constructor(readonly code: string) { super(code); this.name = "CatalogArchiveError"; }
}
const fail = (code: string): never => { throw new CatalogArchiveError(code); };

export class CatalogPrivateArchive implements ProtectedManifestArchive {
  constructor(private readonly bucket: PrivateArchiveBucket, private readonly approvedBucketName: string) {
    if (!approvedBucketName || bucket.name !== approvedBucketName) fail("ARCHIVE_BUCKET_MISMATCH");
  }
  private async checkPrivacy(): Promise<void> {
    let metadata: Metadata;
    try { [metadata] = await this.bucket.getMetadata(); } catch { return fail("ARCHIVE_PRIVACY_UNVERIFIED"); }
    if (this.bucket.name !== this.approvedBucketName
      || metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled !== true
      || metadata.iamConfiguration?.publicAccessPrevention !== "enforced") fail("ARCHIVE_PRIVATE_POLICY_REQUIRED");
  }
  private key(runId: string, leaf: string): string {
    if (!uuid.test(runId)) return fail("INVALID_ARCHIVE_RUN_ID");
    return `${prefix}/${runId}/${leaf}`;
  }
  private async readObject(key: string): Promise<{ bytes: Buffer; generation: string }> {
    let metadata: Metadata;
    try { [metadata] = await this.bucket.file(key).getMetadata(); } catch { return fail("ARCHIVE_OBJECT_UNAVAILABLE"); }
    const generation = String(metadata.generation ?? "");
    const size = Number(metadata.size);
    if (!/^[1-9][0-9]*$/.test(generation) || !Number.isSafeInteger(size) || size < 1 || size > limit
      || !/^[a-f0-9]{64}$/.test(metadata.metadata?.sha256 ?? "")) fail("ARCHIVE_METADATA_INVALID");
    let bytes: Buffer;
    try { [bytes] = await this.bucket.file(key, { generation }).download({ validation: "crc32c" }); }
    catch { return fail("ARCHIVE_READ_FAILED"); }
    if (bytes.byteLength !== size || hash(bytes) !== metadata.metadata!.sha256) fail("ARCHIVE_CHECKSUM_MISMATCH");
    return { bytes, generation };
  }
  private async create(runId: string, leaf: string, reference: string, input: Uint8Array, contentType: string): Promise<ArchiveReceipt> {
    const key = this.key(runId, leaf);
    if (!(input instanceof Uint8Array) || input.byteLength < 1 || input.byteLength > limit) fail("ARCHIVE_SIZE_LIMIT");
    const bytes = Buffer.from(input), sha256 = hash(bytes);
    await this.checkPrivacy();
    try {
      await this.bucket.file(key).save(bytes, {
        resumable: false, validation: "crc32c", preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { contentType, cacheControl: "no-store", metadata: { sha256, runId } },
      });
    } catch (error) {
      // A lost write acknowledgement may still have created the object.
      // Read and reconcile, never overwrite. 412 is an expected retry race.
      if ((error as { code?: unknown } | null)?.code !== 412) {
        try {
          const existing = await this.readObject(key);
          if (hash(existing.bytes) === sha256) return { reference, sha256, bytes: bytes.length, generation: existing.generation };
        } catch { /* outcome is unresolved; do not retry a write */ }
        return fail("ARCHIVE_WRITE_OUTCOME_UNKNOWN");
      }
    }
    const stored = await this.readObject(key);
    if (stored.bytes.byteLength !== bytes.length || hash(stored.bytes) !== sha256) fail("ARCHIVE_IMMUTABILITY_CONFLICT");
    return { reference, sha256, bytes: bytes.length, generation: stored.generation };
  }
  /** Stores the exact original evidence; it never promotes it to live proof. */
  async archiveProvenance(runId: string, bytes: Uint8Array): Promise<ArchiveReceipt> {
    return this.create(runId, "provenance.txt", `private-provenance:${runId}`, bytes, "text/plain; charset=utf-8");
  }
  async readProvenance(reference: string): Promise<Uint8Array> {
    const runId = reference.replace(/^private-provenance:/, "");
    if (reference !== `private-provenance:${runId}`) return fail("INVALID_ARCHIVE_REFERENCE");
    const key = this.key(runId, "provenance.txt");
    await this.checkPrivacy();
    return Uint8Array.from((await this.readObject(key)).bytes);
  }
  async archiveManifest(plan: InitialCatalogPlan): Promise<ArchiveReceipt> {
    const bytes = initialCatalogManifest(plan);
    if (hash(bytes) !== plan.manifestSha256) return fail("ARCHIVE_PLAN_MISMATCH");
    return this.create(plan.runId, "manifest.json", `private-manifest:${plan.runId}`, bytes, "application/json");
  }
  async readManifest(reference: string): Promise<Uint8Array> {
    const runId = reference.replace(/^private-manifest:/, "");
    if (reference !== `private-manifest:${runId}`) return fail("INVALID_ARCHIVE_REFERENCE");
    const key = this.key(runId, "manifest.json");
    await this.checkPrivacy();
    return Uint8Array.from((await this.readObject(key)).bytes);
  }
  async appendOutcome(input: {
    runId: string; eventId: string; state: "prepared" | "committed" | "rolled_back" | "outcome_unknown";
    occurredAt: string; manifestSha256: string;
  }): Promise<ArchiveReceipt> {
    if (!uuid.test(input.eventId) || !["prepared", "committed", "rolled_back", "outcome_unknown"].includes(input.state)
      || !/^[a-f0-9]{64}$/.test(input.manifestSha256)
      || !/(?:Z|[+-]\d{2}:\d{2})$/.test(input.occurredAt) || !Number.isFinite(Date.parse(input.occurredAt))) {
      return fail("INVALID_ARCHIVE_OUTCOME");
    }
    const bytes = Buffer.from(JSON.stringify({
      kind: "tsh-catalog-import-outcome-v1", runId: input.runId, eventId: input.eventId,
      state: input.state, occurredAt: input.occurredAt, manifestSha256: input.manifestSha256,
    }) + "\n");
    return this.create(input.runId, `outcomes/${input.eventId}.json`,
      `private-outcome:${input.runId}:${input.eventId}`, bytes, "application/json");
  }
}
