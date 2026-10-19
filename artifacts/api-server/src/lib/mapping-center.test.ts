import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, stat, chmod, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import type { AddressInfo } from "node:net";
import { transformPrefix, evaluateRule, ruleConflicts, proposalInput,
  individualEvidence, writePrivateProposal, listCenterProposals, saveCenterProposal } from "./mapping-center";
import { parseAvailabilityCatalog } from "./supplier-availability-catalog";
import { BLOCKED_SOURCE_PAIRS, MAPPING_POLICY_COUNTS, REJECTED_MAPPINGS, mappingHold } from "./supplier-mapping-policy";
import { APPROVED_CATALOG_MAPPINGS, CANDIDATE_RULES } from "./sku-mapping";
import { createMappingCenterRouter } from "../routes/mapping-center";
import { GetMappingCenterResponse, PreviewCenterRuleResponse,
  SaveCenterProposalResponse, ListCenterProposalsResponse } from "@workspace/api-zod";

const catalog = parseAvailabilityCatalog(
  "Store SKU,Handle,Title,Option 1,Option 2,Option 3,Vendor\nWDS001,tree,Woodland Tree 1:72,,,,Woodland\nWDS002,tree2,Woodland Trees,,,,Woodland\n",
  "2026-10-05T12:00:00Z", 2);
const source = { supplier: "Fixture supplier", sku: "WOO001", title: "Woodland Tree 1:72" };
const reviewer = { issuer: "fixture-issuer", subject: "fixture-reviewer" };
const input = proposalInput.parse({ kind: "rule", supplier: source.supplier, incoming: "WOO", destination: "WDS",
  reason: "Fixture-only proposed prefix review.", identityChecked: true, unitChecked: true });

test("literal transformations preserve part numbers, separators and original SKUs", () => {
  assert.equal(transformPrefix("WOO00125A/06", "WOO", "WDS"), "WDS00125A/06");
  assert.equal(transformPrefix("WOO-001", "WOO", "WDS"), "WDS-001");
  assert.equal(transformPrefix("785-001", "785-", "WDS"), "WDS001");
  assert.equal(transformPrefix("ZZZ001", "WOO", "WDS"), null);
  assert.equal(transformPrefix("WOO", "WOO", "WDS"), null);
  assert.equal(source.sku, "WOO001");
});
test("title/scale/size checks never establish identity; definite mismatches are flagged", () => {
  const same = evaluateRule([source], catalog.variants, "WOO", "WDS")[0];
  assert.equal(same.status, "review");
  assert.equal(same.verified, false);
  assert.equal(same.publishable, false);
  const different = evaluateRule([{ ...source, title: "Tree 1:48" }], catalog.variants, "WOO", "WDS")[0];
  assert.equal(different.status, "conflict");
  assert.ok(different.warnings.includes("Scale mismatch."));
  const sized = evaluateRule([{ ...source, title: "Paint 10ml" }],
    [{ ...catalog.variants[0], title: "Paint 20ml" }], "WOO", "WDS")[0];
  assert.ok(sized.warnings.includes("Size mismatch."));
});
test("duplicate destinations, missing destinations and same-supplier collisions are rejected as candidates", () => {
  assert.equal(evaluateRule([source], [...catalog.variants, catalog.variants[0]], "WOO", "WDS")[0].status, "conflict");
  assert.equal(evaluateRule([{ ...source, sku: "WOO999" }], catalog.variants, "WOO", "WDS")[0].status, "conflict");
  const collisions = evaluateRule([source, { ...source, sku: "woo001" }], catalog.variants, "WOO", "WDS");
  assert.ok(collisions.every(r => r.warnings.some(w => w.includes("collision"))));
  const independent = evaluateRule([source, { ...source, supplier: "Another fixture" }], catalog.variants, "WOO", "WDS");
  assert.ok(independent.every(r => !r.warnings.some(w => w.includes("Same-supplier"))));
});
test("all 209 holds and 12 terminal null rejections survive previews and individual evidence", () => {
  assert.deepEqual(MAPPING_POLICY_COUNTS, { rejectedMappings: 12, flaggedCandidates: 200, uniqueHeldSources: 209 });
  let count = 0;
  for (const [supplier, pairs] of Object.entries(BLOCKED_SOURCE_PAIRS)) for (const sku of Object.keys(pairs)) {
    const s = { supplier, sku, title: null };
    const row = evaluateRule([s], catalog.variants, sku.slice(0, 3), "WDS")[0];
    assert.equal(row.status, "protected"); assert.equal(row.publishable, false);
    assert.ok(individualEvidence(s, catalog.variants[0]).hold);
    count++;
  }
  assert.equal(count, 209);
  for (const sku of Object.keys(REJECTED_MAPPINGS)) assert.equal(APPROVED_CATALOG_MAPPINGS["MMD/Squadron"][sku], null);
  assert.equal(CANDIDATE_RULES.length, 72);
});
test("individual overrides and overlapping rules retain precedence", () => {
  const [supplier, entries] = Object.entries(APPROVED_CATALOG_MAPPINGS).find(([, mappings]) => Object.values(mappings).some(Boolean))!;
  const [sku] = Object.entries(entries).find(([, target]) => target)!;
  const row = evaluateRule([{ supplier, sku, title: null }], catalog.variants, sku.slice(0, 3), "WDS")[0];
  assert.ok(row.warnings.some(w => w.includes("individual exception")));
  assert.equal(row.publishable, false);
  assert.ok(ruleConflicts("HobbyTyme", "WOO", "OTHER").length);
});
test("proposals require real selections, literal prefixes, checks and reason", () => {
  assert.equal(proposalInput.safeParse({ ...input, identityChecked: false }).success, false);
  assert.equal(proposalInput.safeParse({ ...input, incoming: ".*" }).success, false);
  assert.equal(proposalInput.safeParse({ ...input, reason: "short" }).success, false);
  assert.equal(proposalInput.safeParse({ ...input, kind: "individual" }).success, false);
  assert.equal(proposalInput.safeParse({ ...input, active: true }).success, false);
});
test("private immutable proposal journal preserves evidence and refuses insecure paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tsh-center-journal-"));
  try {
    const a = await writePrivateProposal(root, input, { fixture: true }, reviewer);
    const first = await readFile(path.join(root, `${a.id}.json`), "utf8");
    const b = await writePrivateProposal(root, input, { fixture: "second" }, reviewer);
    assert.notEqual(a.id, b.id);
    assert.equal(await readFile(path.join(root, `${a.id}.json`), "utf8"), first);
    assert.equal((await stat(root)).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(root, `${a.id}.json`))).mode & 0o777, 0o600);
    const restored = JSON.parse(first);
    assert.deepEqual(restored.reviewer, reviewer);
    assert.equal(restored.active, false); assert.equal(restored.futureImportsEnabled, false);
    assert.equal((await listCenterProposals(root)).length, 2);
    await chmod(root, 0o755);
    await assert.rejects(writePrivateProposal(root, input, {}, reviewer), /NOT_PRIVATE/);
    await chmod(root, 0o700);
    await symlink(root, `${root}-link`);
    await assert.rejects(writePrivateProposal(`${root}-link`, input, {}, reviewer), /NOT_PRIVATE/);
  } finally { await rm(`${root}-link`, { force: true }); await rm(root, { recursive: true, force: true }); }
});
test("production cannot use the development proposal writer", async () => {
  const before = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    await assert.rejects(saveCenterProposal("/home/runner/tsh-private-mapping-proposals", input, {}, reviewer), /DEVELOPMENT/);
  } finally { if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before; }
});
test("both HTTP workflows round-trip isolated proposals; unauthorized saves, invalid selections and activation fail closed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tsh-center-api-"));
  const rejected = Object.keys(REJECTED_MAPPINGS).map(sku => ({ supplier: "MMD/Squadron", sku, title: "" }));
  const sources = [source, ...rejected];
  const app = express(); app.use(express.json());
  app.use("/api", createMappingCenterRouter({
    suppliers: async () => ["Fixture supplier", "MMD/Squadron", "Future supplier"],
    ruleSources: async (supplier, incoming) => sources.filter(s => (!supplier || s.supplier === supplier) && s.sku.startsWith(incoming)),
    source: async (supplier, sku) => sources.filter(s => s.supplier === supplier && s.sku === sku),
    search: async () => ({ items: sources, total: sources.length, page: 1, totalPages: 1 }),
    catalog: async () => catalog,
    save: async (_root, value, evidence, identity) => writePrivateProposal(root, value, evidence, identity),
    list: async () => listCenterProposals(root),
  }, (req, res, next) => {
    if (req.get("x-fixture-reviewer") !== "yes") { res.status(401).json({ code: "REVIEWER_SIGN_IN_REQUIRED" }); return; }
    res.locals.mappingReviewer = reviewer; next();
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call = (endpoint: string, body?: unknown, auth = true) => fetch(base + endpoint, {
    method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...(auth ? { "x-fixture-reviewer": "yes" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  try {
    const config = GetMappingCenterResponse.parse(await (await call("/mapping-center")).json());
    assert.equal(config.heldCount, 209); assert.ok(config.suppliers.includes("Future supplier"));
    const preview = PreviewCenterRuleResponse.parse(await (await call("/mapping-center/preview", { supplier: "", incoming: "WOO", destination: "WDS" })).json());
    assert.equal(preview.items[0].proposedSku, "WDS001");
    assert.equal((await call("/mapping-center/proposals", input, false)).status, 401);
    assert.equal((await call("/mapping-center/proposals", { ...input, reason: "bad" })).status, 400);
    assert.equal((await call("/mapping-center/proposals", input)).status, 201);
    for (const s of rejected) {
      const response = await call("/mapping-center/proposals", { kind: "individual", supplier: s.supplier,
        originalSku: s.sku, catalogKey: catalog.variants[0].key, reason: "Fixture-only historical correction proposal.",
        identityChecked: true, unitChecked: true });
      assert.equal(response.status, 201);
      const receipt = SaveCenterProposalResponse.parse(await response.json());
      const saved = JSON.parse(await readFile(path.join(root, `${receipt.id}.json`), "utf8"));
      assert.equal(saved.evidence.hold.status, "rejected");
      assert.equal(saved.active, false);
      assert.ok(mappingHold(s.supplier, s.sku));
    }
    assert.equal(ListCenterProposalsResponse.parse(await (await call("/mapping-center/proposals")).json()).items.length, 13);
    const invalid = { kind: "individual", supplier: source.supplier, originalSku: source.sku, catalogKey: "invented",
      reason: "Fixture-only invalid destination.", identityChecked: true, unitChecked: true };
    assert.equal((await call("/mapping-center/proposals", invalid)).status, 409);
    assert.equal((await call("/mapping-center/approve", input)).status, 404);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
