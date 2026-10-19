/** Development-only inactive proposals. Never used by mapping, ingestion, or publishing. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, lstat, realpath, readdir, readFile, open, link, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import type { proposalInput } from "./mapping-center";
import type { MappingReviewer } from "./reviewer-authorization";

type Input = z.infer<typeof proposalInput>;
type Evidence = {
  source?: { supplier: string; sku: string; title: string | null };
  destination?: { key: string; sku: string; title: string };
  [key: string]: unknown;
};
type RecordData = {
  id: string; createdAt: string; reviewer: MappingReviewer; input: Input; evidence: Evidence;
  state: string; active: boolean; futureImportsEnabled: boolean; publishable: boolean;
};
type Event = {
  revision: number; action: "edited" | "deleted"; at: string; reviewer: MappingReviewer; record: RecordData;
};
const validId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export class ProposalJournalError extends Error {
  constructor(public status: number, message: string, public existingId?: string) { super(message); }
}
export function assertProposalRuntime(root: string) {
  if (process.env.NODE_ENV !== "development") throw new Error("DEVELOPMENT_PROPOSAL_STORAGE_ONLY");
  if (root !== "/home/runner/tsh-private-mapping-proposals") throw new Error("UNSAFE_PROPOSAL_PATH");
}
async function privateDirectory(root: string) {
  if (!path.isAbsolute(root)) throw new Error("UNSAFE_PROPOSAL_PATH");
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0
    || info.uid !== process.getuid?.() || await realpath(root) !== root) throw new Error("PROPOSAL_STORAGE_NOT_PRIVATE");
}
async function readPrivate(file: string) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.())
    throw new Error("PROPOSAL_FILE_NOT_PRIVATE");
  return JSON.parse(await readFile(file, "utf8"));
}
async function names(root: string) {
  try {
    await privateDirectory(root);
    return (await readdir(root)).filter(name => validId.test(name.replace(/\.json$/, "")) && name.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
function assertInactive(record: RecordData) {
  if (record.state !== "proposed" || record.active !== false || record.publishable !== false
    || record.futureImportsEnabled !== false) throw new ProposalJournalError(409, "ONLY_INACTIVE_PROPOSALS_CAN_BE_CHANGED");
}
export async function readProposalJournal(root: string, id: string) {
  if (!validId.test(id)) throw new ProposalJournalError(400, "INVALID_PROPOSAL_ID");
  await privateDirectory(root);
  let original: RecordData;
  try { original = await readPrivate(path.join(root, `${id}.json`)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ProposalJournalError(404, "PROPOSAL_NOT_FOUND");
    throw error;
  }
  if (original.id !== id || !original.input || !original.reviewer) throw new Error("INVALID_PROPOSAL_RECORD");
  let events: Event[] = [];
  const directory = path.join(root, "history");
  let historyExists = true;
  try {
    await privateDirectory(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") historyExists = false;
    else throw error;
  }
  if (historyExists) {
    const files = (await readdir(directory)).filter(name => name.startsWith(`${id}.`) && /^\d+\.json$/.test(name.slice(id.length + 1)));
    events = await Promise.all(files.map(name => readPrivate(path.join(directory, name))));
    events.sort((a, b) => a.revision - b.revision);
    events.forEach((event, index) => {
      if (event.revision !== index + 1 || event.record?.id !== id || !["edited", "deleted"].includes(event.action)
        || (index > 0 && events[index - 1].action === "deleted")) throw new Error("INVALID_PROPOSAL_HISTORY");
    });
  }
  return { original, record: events.at(-1)?.record ?? original, events, revision: events.length,
    deleted: events.at(-1)?.action === "deleted" };
}
export async function proposalJournalDetail(root: string, id: string) {
  const journal = await readProposalJournal(root, id);
  if (journal.deleted) throw new ProposalJournalError(410, "PROPOSAL_DELETED");
  const { record, original, events } = journal;
  const audit = (action: string, at: string, reviewer: MappingReviewer, snapshot: RecordData) => ({
    action, at, reviewerIssuer: reviewer.issuer ?? null, reviewerSubject: reviewer.subject ?? null,
    reason: snapshot.input.reason, catalogSku: snapshot.evidence?.destination?.sku ?? null,
    catalogTitle: snapshot.evidence?.destination?.title ?? null,
  });
  return {
    id, kind: record.input.kind, createdAt: original.createdAt, updatedAt: events.at(-1)?.at ?? null,
    revision: journal.revision, state: record.state, active: record.active,
    supplier: record.input.supplier, originalSku: record.input.originalSku,
    supplierTitle: record.evidence?.source?.title ?? null,
    catalogKey: record.input.catalogKey, catalogSku: record.evidence?.destination?.sku ?? null,
    catalogTitle: record.evidence?.destination?.title ?? null, reason: record.input.reason,
    identityChecked: record.input.identityChecked, unitChecked: record.input.unitChecked,
    reviewerIssuer: original.reviewer.issuer ?? null, reviewerSubject: original.reviewer.subject ?? null,
    history: [audit("created", original.createdAt, original.reviewer, original),
      ...events.map(event => audit(event.action, event.at, event.reviewer, event.record))],
  };
}
export async function listProposalJournal(root: string) {
  const journals = await Promise.all((await names(root)).map(name => readProposalJournal(root, name.slice(0, -5))));
  return journals.filter(j => !j.deleted).sort((a, b) => b.original.createdAt.localeCompare(a.original.createdAt))
    .slice(0, 50).map(({ record }) => ({
      id: record.id, createdAt: record.createdAt, kind: record.input.kind,
      summary: record.input.kind === "rule" ? `${record.input.supplier || "All suppliers"}: ${record.input.incoming} → ${record.input.destination}`
        : `${record.input.supplier}: ${record.input.originalSku}`, state: record.state,
    }));
}
async function withWriteLock<T>(root: string, action: () => Promise<T>) {
  if (!path.isAbsolute(root)) throw new Error("UNSAFE_PROPOSAL_PATH");
  await mkdir(root, { recursive: true, mode: 0o700 });
  await privateDirectory(root);
  const lock = path.join(root, ".proposal-write-lock");
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new ProposalJournalError(409, "PROPOSAL_STORAGE_BUSY_RETRY");
    throw error;
  }
  try { return await action(); } finally { await rmdir(lock); }
}
/** Publish complete immutable JSON atomically; a crash cannot expose partial records. */
async function appendImmutable(directory: string, name: string, data: unknown) {
  const temporary = path.join(directory, `.${randomUUID()}.pending`);
  const file = await open(temporary, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(data)); await file.sync(); } finally { await file.close(); }
  try {
    await link(temporary, path.join(directory, name));
    const dir = await open(directory, "r");
    try { await dir.sync(); } finally { await dir.close(); }
  } finally { await unlink(temporary); }
}
async function assertNoDuplicate(root: string, input: Input, evidence: Evidence, excludeId?: string) {
  if (input.kind !== "individual") return;
  for (const name of await names(root)) {
    const journal = await readProposalJournal(root, name.slice(0, -5));
    const existing = journal.record;
    const normalize = (value: string) => value.trim().toLowerCase();
    if (existing.id !== excludeId && !journal.deleted && existing.input.kind === "individual"
      && existing.active === false && existing.state === "proposed"
      && normalize(existing.input.supplier) === normalize(input.supplier)
      && normalize(existing.input.originalSku) === normalize(input.originalSku)
      && (existing.input.catalogKey === input.catalogKey || (evidence.destination?.sku
        && normalize(existing.evidence?.destination?.sku ?? "") === normalize(evidence.destination.sku)))) {
      throw new ProposalJournalError(409, "DUPLICATE_INACTIVE_PROPOSAL", existing.id);
    }
  }
}
export async function createProposalJournal(root: string, input: Input, evidence: unknown, reviewer: MappingReviewer) {
  return withWriteLock(root, async () => {
    const snapshot = evidence as Evidence;
    await assertNoDuplicate(root, input, snapshot);
    const id = randomUUID(), createdAt = new Date().toISOString();
    const record: RecordData = { id, createdAt, reviewer, input, evidence: snapshot,
      state: "proposed", active: false, futureImportsEnabled: false, publishable: false };
    await appendImmutable(root, `${id}.json`, record);
    return { id, createdAt, state: "proposed", active: false,
      sha256: createHash("sha256").update(JSON.stringify(record)).digest("hex") };
  });
}
export async function changeProposalJournal(root: string, id: string, revision: number,
  change: { input: Input; evidence: unknown } | null, reviewer: MappingReviewer) {
  return withWriteLock(root, async () => {
    const journal = await readProposalJournal(root, id);
    if (journal.deleted) throw new ProposalJournalError(410, "PROPOSAL_DELETED");
    assertInactive(journal.record);
    if (revision !== journal.revision) throw new ProposalJournalError(409, "PROPOSAL_CHANGED_RELOAD_REQUIRED");
    let record = journal.record;
    if (change) {
      if (record.input.kind !== "individual" || change.input.kind !== "individual"
        || record.input.supplier !== change.input.supplier || record.input.originalSku !== change.input.originalSku)
        throw new ProposalJournalError(400, "PROPOSAL_SOURCE_CANNOT_CHANGE");
      await assertNoDuplicate(root, change.input, change.evidence as Evidence, id);
      record = { ...record, input: change.input, evidence: change.evidence as Evidence };
    }
    const directory = path.join(root, "history");
    await mkdir(directory, { mode: 0o700, recursive: true });
    await privateDirectory(directory);
    await appendImmutable(directory, `${id}.${revision + 1}.json`, {
      revision: revision + 1, action: change ? "edited" : "deleted", at: new Date().toISOString(), reviewer, record,
    } satisfies Event);
    return { id, deleted: !change };
  });
}
