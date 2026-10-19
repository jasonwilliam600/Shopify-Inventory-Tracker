import { Router, type IRouter, type RequestHandler } from "express";
import { db, supplierInventoryTable as inventory } from "@workspace/db";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import {
  GetMappingCenterResponse, PreviewCenterRuleBody, PreviewCenterRuleResponse,
  SearchCenterSourcesQueryParams, SearchCenterSourcesResponse,
  SaveCenterProposalResponse, ListCenterProposalsResponse,
  GetCenterProposalResponse, UpdateCenterProposalBody, DeleteCenterProposalBody,
} from "@workspace/api-zod";
import { loadAvailabilityCatalog } from "../lib/supplier-availability-catalog";
import { CANDIDATE_RULES } from "../lib/sku-mapping";
import { MAPPING_POLICY_COUNTS } from "../lib/supplier-mapping-policy";
import { evaluateRule, individualEvidence, proposalInput, ruleConflicts,
  saveCenterProposal, listCenterProposals } from "../lib/mapping-center";
import { requireMappingReviewer, workflowError, type MappingReviewer } from "../lib/reviewer-authorization";
import { assertProposalRuntime, proposalJournalDetail, readProposalJournal,
  changeProposalJournal, ProposalJournalError } from "../lib/mapping-proposal-journal";

const root = "/home/runner/tsh-private-mapping-proposals";
const fields = { supplier: inventory.supplier, sku: inventory.sku, title: inventory.productName };
const approvalBlocker = "Historical catalog only: proposals cannot be approved or activated for future imports until current product identities, selling units and reviewer authorization are verified. Publishing is disabled.";
const defaultResources = {
async suppliers() {
  return (await db.selectDistinct({ name: inventory.supplier }).from(inventory).orderBy(asc(inventory.supplier)))
    .map(r => r.name).filter((name): name is string => Boolean(name));
},
async ruleSources(supplier: string, incoming: string) {
  return db.select(fields).from(inventory).where(and(
    supplier ? eq(inventory.supplier, supplier) : undefined,
    sql`left(upper(btrim(${inventory.sku})), ${incoming.length}) = ${incoming.toUpperCase()}`,
  )).orderBy(asc(inventory.supplier), asc(inventory.sku)).limit(50_001);
},
async source(supplier: string, sku: string) {
  return db.select(fields).from(inventory).where(and(
    eq(inventory.supplier, supplier), eq(inventory.sku, sku))).limit(2);
},
async search(search: string, supplier: string | undefined, page: number) {
  const term = `%${search.trim().replace(/[\\%_]/g, "\\$&")}%`;
  const where = and(supplier ? eq(inventory.supplier, supplier) : undefined,
    or(ilike(inventory.sku, term), ilike(inventory.productName, term)));
  const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(inventory).where(where);
  const totalPages = Math.max(1, Math.ceil(count.total / 25)), current = Math.min(page, totalPages);
  const items = await db.select(fields).from(inventory).where(where)
    .orderBy(asc(inventory.supplier), asc(inventory.sku)).limit(25).offset((current - 1) * 25);
  return { items, total: count.total, page: current, totalPages };
},
catalog: loadAvailabilityCatalog,
save: saveCenterProposal,
list: listCenterProposals,
detail: proposalJournalDetail,
read: readProposalJournal,
async change(directory: string, ...args: Parameters<typeof changeProposalJournal> extends [string, ...infer R] ? R : never) {
  assertProposalRuntime(directory);
  return changeProposalJournal(directory, ...args);
},
};

/** Resource injection is used only by isolated fixture tests; API inputs cannot select resources. */
export function createMappingCenterRouter(resources = defaultResources, guard: RequestHandler = requireMappingReviewer): IRouter {
const router: IRouter = Router();
function failure(res: Parameters<typeof workflowError>[0], error: unknown) {
  if (error instanceof ProposalJournalError) {
    res.status(error.status).json({ error: error.message, existingId: error.existingId }); return;
  }
  workflowError(res, error);
}
async function catalogEvidence(supplier: string, sku: string, catalogKey: string) {
  const sources = await resources.source(supplier, sku);
  const catalog = await resources.catalog();
  const destination = catalog.variants.find(v => v.key === catalogKey);
  if (sources.length !== 1 || !destination?.sku || destination.skuStatus !== "unique")
    throw new ProposalJournalError(409, "Select one current supplier record and a unique historical SKU destination.");
  return { ...individualEvidence(sources[0], destination), catalogObservedAt: catalog.metadata.observedAt };
}
async function ruleEvidence(supplier: string, incoming: string, destination: string) {
  const available = await resources.suppliers();
  if (supplier && !available.includes(supplier)) throw new Error("UNKNOWN_SUPPLIER");
  const sources = await resources.ruleSources(supplier, incoming);
  if (sources.length > 50_000) throw new Error("NARROW_PREFIX_REQUIRED");
  const catalog = await resources.catalog();
  return { items: evaluateRule(sources, catalog.variants, incoming, destination),
    conflicts: ruleConflicts(supplier, incoming, destination), catalogObservedAt: catalog.metadata.observedAt };
}
router.use("/mapping-center", (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.get("/mapping-center", async (_req, res): Promise<void> => {
  try {
    res.json(GetMappingCenterResponse.parse({ suppliers: await resources.suppliers(), ruleCount: CANDIDATE_RULES.length,
      rejectedCount: MAPPING_POLICY_COUNTS.rejectedMappings, heldCount: MAPPING_POLICY_COUNTS.uniqueHeldSources, approvalBlocker }));
  } catch (e) { workflowError(res, e); }
});
router.post("/mapping-center/preview", async (req, res): Promise<void> => {
  const parsed = PreviewCenterRuleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid rule preview." }); return; }
  const { supplier, incoming: rawIn, destination: rawOut, search = "", status = "all", page = 1 } = parsed.data;
  const incoming = rawIn.trim(), destination = rawOut.trim();
  if (![incoming, destination].every(v => /^[A-Za-z0-9][A-Za-z0-9 /:_-]{0,29}$/.test(v))) {
    res.status(400).json({ error: "Enter literal SKU prefixes, not wildcard expressions." }); return;
  }
  try {
    const evidence = await ruleEvidence(supplier, incoming, destination);
    const term = search.toLowerCase();
    const filtered = evidence.items.filter(r => (status === "all" || r.status === status)
      && (!term || [r.supplier, r.originalSku, r.supplierTitle ?? "", r.proposedSku, r.catalogTitle ?? ""]
        .some(v => v.toLowerCase().includes(term))));
    const totalPages = Math.max(1, Math.ceil(filtered.length / 25)), current = Math.min(page, totalPages);
    res.json(PreviewCenterRuleResponse.parse({ items: filtered.slice((current - 1) * 25, current * 25),
      total: filtered.length, affected: evidence.items.length, page: current, totalPages, conflicts: evidence.conflicts }));
  } catch (e) {
    if (e instanceof Error && ["UNKNOWN_SUPPLIER", "NARROW_PREFIX_REQUIRED"].includes(e.message)) {
      res.status(400).json({ error: e.message }); return;
    }
    workflowError(res, e);
  }
});
router.get("/mapping-center/sources", async (req, res): Promise<void> => {
  const parsed = SearchCenterSourcesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Search requires 2–200 characters." }); return; }
  const { search, supplier, page = 1 } = parsed.data;
  if (search.trim().length < 2) { res.status(400).json({ error: "Enter at least two non-space characters." }); return; }
  try {
    res.json(SearchCenterSourcesResponse.parse(await resources.search(search, supplier, page)));
  } catch (e) { workflowError(res, e); }
});
router.get("/mapping-center/proposals", guard, async (_req, res): Promise<void> => {
  try { res.json(ListCenterProposalsResponse.parse({ items: await resources.list(root) })); }
  catch (e) { workflowError(res, e); }
});
router.post("/mapping-center/proposals", guard, async (req, res): Promise<void> => {
  const parsed = proposalInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Select products or prefixes, confirm checks, and provide a reason of at least 12 characters." }); return; }
  try {
    const input = parsed.data;
    let evidence: unknown;
    if (input.kind === "rule") {
      evidence = await ruleEvidence(input.supplier, input.incoming, input.destination);
      if (!(evidence as Awaited<ReturnType<typeof ruleEvidence>>).items.length) {
        res.status(409).json({ error: "No affected supplier products. Preview a valid rule first." }); return;
      }
    } else {
      evidence = await catalogEvidence(input.supplier, input.originalSku, input.catalogKey);
    }
    const receipt = await resources.save(root, input, evidence, res.locals.mappingReviewer as MappingReviewer);
    res.status(201).json(SaveCenterProposalResponse.parse(receipt));
  } catch (e) { failure(res, e); }
});
router.get("/mapping-center/proposals/:id", guard, async (req, res): Promise<void> => {
  try { res.json(GetCenterProposalResponse.parse(await resources.detail(root, String(req.params.id)))); }
  catch (e) { failure(res, e); }
});
router.patch("/mapping-center/proposals/:id", guard, async (req, res): Promise<void> => {
  const parsed = UpdateCenterProposalBody.strict().safeParse(req.body);
  if (!parsed.success || parsed.data.identityChecked !== true || parsed.data.unitChecked !== true) {
    res.status(400).json({ error: "Renew both verification confirmations and provide a valid destination and reason." }); return;
  }
  try {
    const id = String(req.params.id), current = await resources.read(root, id);
    if (current.deleted) throw new ProposalJournalError(410, "PROPOSAL_DELETED");
    if (current.record.input.kind !== "individual") throw new ProposalJournalError(400, "INDIVIDUAL_PROPOSAL_REQUIRED");
    const checked = proposalInput.safeParse({ ...current.record.input, catalogKey: parsed.data.catalogKey,
      reason: parsed.data.reason, identityChecked: true, unitChecked: true });
    if (!checked.success) { res.status(400).json({ error: "A non-space reason of 12–2000 characters is required." }); return; }
    const input = checked.data;
    const evidence = await catalogEvidence(input.supplier, input.originalSku, input.catalogKey);
    await resources.change(root, id, parsed.data.revision, { input, evidence }, res.locals.mappingReviewer);
    res.json(GetCenterProposalResponse.parse(await resources.detail(root, id)));
  } catch (e) { failure(res, e); }
});
router.delete("/mapping-center/proposals/:id", guard, async (req, res): Promise<void> => {
  const parsed = DeleteCenterProposalBody.strict().safeParse(req.body);
  if (!parsed.success || parsed.data.confirmed !== true) {
    res.status(400).json({ error: "Explicit deletion confirmation is required." }); return;
  }
  try {
    res.json(await resources.change(root, String(req.params.id), parsed.data.revision, null, res.locals.mappingReviewer));
  } catch (e) { failure(res, e); }
});
return router;
}
export default createMappingCenterRouter();
