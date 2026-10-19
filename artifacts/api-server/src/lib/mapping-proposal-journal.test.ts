import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { proposalInput } from "./mapping-center";
import { createProposalJournal, changeProposalJournal, proposalJournalDetail, readProposalJournal,
  listProposalJournal, ProposalJournalError, assertProposalRuntime } from "./mapping-proposal-journal";

const reviewer = { issuer: "fixture-issuer", subject: "fixture-reviewer" };
const input = proposalInput.parse({ kind: "individual", supplier: "Fixture", originalSku: "FIX001",
  catalogKey: "historical1", reason: "Manually verified product match", identityChecked: true, unitChecked: true });
const evidence = { source: { supplier: "Fixture", sku: "FIX001", title: "Fixture title" },
  destination: { key: "historical1", sku: "STORE001", title: "Historical fixture" }, hold: { status: "rejected" } };

test("concurrent duplicate creation and edits cannot create overlapping inactive proposals", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tsh-proposal-race-"));
  try {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => createProposalJournal(root, input, evidence, reviewer)));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((await listProposalJournal(root)).length, 1);
    const first = (await listProposalJournal(root))[0];
    await assert.rejects(createProposalJournal(root, input, evidence, reviewer),
      (error: unknown) => error instanceof ProposalJournalError && error.existingId === first.id);
    const secondInput = { ...input, catalogKey: "historical2" };
    const secondEvidence = { ...evidence, destination: { ...evidence.destination, key: "historical2", sku: "STORE002" } };
    const second = await createProposalJournal(root, secondInput, secondEvidence, reviewer);
    await assert.rejects(changeProposalJournal(root, second.id, 0, { input, evidence }, reviewer), /DUPLICATE/);
    const edited = await Promise.allSettled([
      changeProposalJournal(root, first.id, 0, { input: { ...input, reason: "First isolated reason change" }, evidence }, reviewer),
      changeProposalJournal(root, first.id, 0, { input: { ...input, reason: "Second isolated reason change" }, evidence }, reviewer),
    ]);
    assert.equal(edited.filter(r => r.status === "fulfilled").length, 1);
    const journal = await readProposalJournal(root, first.id);
    assert.equal(journal.events.length, 1);
    assert.deepEqual(journal.record.evidence.hold, { status: "rejected" });
    await changeProposalJournal(root, first.id, 1, null, reviewer);
    assert.ok(!(await listProposalJournal(root)).some(item => item.id === first.id));
    const recreated = await createProposalJournal(root, input, evidence, reviewer);
    assert.notEqual(recreated.id, first.id);
    assert.equal((await readProposalJournal(root, first.id)).events.at(-1)?.action, "deleted");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("legacy duplicates and original audit evidence remain untouched; active records cannot be edited or deleted", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tsh-proposal-legacy-"));
  try {
    const first = await createProposalJournal(root, input, evidence, reviewer);
    const filename = path.join(root, `${first.id}.json`);
    const text = await readFile(filename, "utf8");
    const duplicateId = "11111111-1111-4111-8111-111111111111";
    await writeFile(path.join(root, `${duplicateId}.json`), JSON.stringify({ ...JSON.parse(text), id: duplicateId }), { mode: 0o600 });
    assert.equal((await listProposalJournal(root)).length, 2);
    await assert.rejects(createProposalJournal(root, input, evidence, reviewer), /DUPLICATE/);
    assert.equal(await readFile(filename, "utf8"), text);
    const legacy = await proposalJournalDetail(root, duplicateId);
    assert.equal(legacy.revision, 0); assert.equal(legacy.history.length, 1);
    assert.equal(legacy.reason, input.reason);
    await writeFile(filename, JSON.stringify({ ...JSON.parse(text), active: true }), { mode: 0o600 });
    await assert.rejects(changeProposalJournal(root, first.id, 0, null, reviewer), /ONLY_INACTIVE/);
    await assert.rejects(changeProposalJournal(root, first.id, 0, { input, evidence }, reviewer), /ONLY_INACTIVE/);
    await assert.rejects(proposalJournalDetail(root, "../../outside"), /INVALID_PROPOSAL_ID/);
    await mkdir(path.join(root, ".proposal-write-lock"), { mode: 0o700 });
    await assert.rejects(createProposalJournal(root, input, evidence, reviewer), /STORAGE_BUSY/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("management runtime rejects production and unapproved directories", () => {
  const before = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    assert.throws(() => assertProposalRuntime("/home/runner/tsh-private-mapping-proposals"), /DEVELOPMENT/);
    process.env.NODE_ENV = "development";
    assert.throws(() => assertProposalRuntime("/tmp/not-approved"), /UNSAFE/);
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  }
});
