/** Offline, authenticated export planning. No Shopify transports or DB writes. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Writable } from "node:stream";
import ExcelJS from "exceljs";
import { MappingApprovalRepository, catalogFresh, supplierIdentityFingerprint } from "./mapping-approval";
import type { MappingReviewer } from "./reviewer-authorization";
import { WorkflowError } from "./reviewer-authorization";
import { buildSyncPlan, digest, assertGeneratedSyncPlan } from "./synchronization-plan";
import type { SyncPlan, SyncMapping, SupplierSyncOffer, VerifiedSyncVariant, VariantSupplierVisibility } from "./synchronization-types";
import { SYNC_SUPPLIERS } from "./synchronization-types";
import { mappingHold } from "./supplier-mapping-policy";
import { supplierVisibilityValues, SUPPLIER_METAFIELD_KEYS } from "./supplier-variant-metafields";
import { exportPolicy, privateMetafieldsReady, MATRIXIFY_NAMESPACE, type MatrixifyConfiguration } from "./matrixify-configuration";
import { parseMatrixifyBaseline, shopifyNumericId, MATRIXIFY_BASELINE_MAX_BYTES } from "./matrixify-baseline";

export const matrixifyPreviewInput = z.object({
  baselineCsv: z.string().min(1).max(MATRIXIFY_BASELINE_MAX_BYTES),
  baselineObservedAt: z.string().datetime({ offset: true }),
  baselineConfirmed: z.literal(true),
  variantIds: z.array(z.string().regex(/^gid:\/\/shopify\/ProductVariant\/[1-9]\d*$/)).min(1).max(10000).optional(),
}).strict();
export const matrixifyDownloadInput = z.object({
  previewId: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/),
  profile: z.enum(["inventory", "supplier_metafields", "prices"]),
}).strict();
export type ExportProfile = z.infer<typeof matrixifyDownloadInput>["profile"];
type Data = Awaited<ReturnType<MappingApprovalRepository["readData"]>>;
export interface MatrixifyException { variantId: string; code: string; supplier: string | null; originalSku: string | null }
export interface MatrixifyRow {
  variantId: string; sku: string; title: string; beforeQuantity: number | null; afterQuantity: number | null;
  beforePrice: string; afterPrice: string | null; supplierSummary: string[];
}
interface CachedExport {
  id: string; owner: string; plan: SyncPlan; config: MatrixifyConfiguration; sourceDigest: string;
  configDigest: string; variants: VerifiedSyncVariant[];
  rows: MatrixifyRow[]; exceptions: MatrixifyException[];
  inventory: Map<string, number>; prices: Map<string, string>; metadata: Map<string, Record<string, string>>;
}
function reject(code: string, status = 409): never { throw new WorkflowError(code, status); }
const ownerKey = (r: MappingReviewer) => digest([r.issuer, r.subject]);
const warnings = [
  "This application does not upload to Shopify or Matrixify. Importing a workbook is a separate live operation requiring owner approval.",
  "Only the Products sheet is importable. TSH Exceptions and TSH Review are reports; do not import them.",
  "Matrixify absolute inventory updates do not provide the API executor's compare-and-set or transaction guarantees. Orders and edits during a manual import can make a downloaded file stale.",
  "The CSV export time is owner-attested, not independently proven by its filename or filesystem timestamps.",
  "Use each workbook only for its stated store and exact existing location. Do not reuse an old file or automatically import it.",
  "These are private workbooks containing supplier information. Do not put them on public links or commit them to Git.",
  "Supplier metafield assignments are proposed values, not compare-and-set changes. Merchant-owned fields permit other Admin apps access; Storefront API NONE alone does not certify theme privacy.",
];
function inputs(data: Data) {
  const sourceIndex = new Map(data.sources.map(s => [JSON.stringify([s.supplier, s.sku]), s]));
  const mappings: SyncMapping[] = data.decisions.map(d => ({
    id: d.id, revision: Number(d.version), supplier: d.supplier_id, originalSku: d.original_supplier_sku,
    state: d.state === "approved" ? "approved" : "candidate", variantId: d.variant_gid,
    identityFingerprint: String(d.product_identity_snapshot.identity_fingerprint ?? ""),
    sellingUnitsVerified: d.selling_unit_snapshot.confirmed === true && d.selling_unit_snapshot.retail_units_per_supplier_unit === 1
      && sourceIndex.has(JSON.stringify([d.supplier_id, d.original_supplier_sku]))
      && d.selling_unit_snapshot.sourceIdentityFingerprint === supplierIdentityFingerprint(sourceIndex.get(JSON.stringify([d.supplier_id, d.original_supplier_sku]))!),
  }));
  const decisions = new Map(data.decisions.map(d => [JSON.stringify([d.supplier_id, d.original_supplier_sku]), d]));
  const offers: SupplierSyncOffer[] = data.sources.map(s => {
    const unit = decisions.get(JSON.stringify([s.supplier, s.sku]))?.selling_unit_snapshot;
    const cost = unit?.cost as { amount?: unknown; basis?: unknown; packSize?: unknown; verifiedAt?: unknown } | null | undefined;
    const rawPrice = String(s.supplier_price ?? "");
    const current = /^\d+(\.\d{1,2})?$/.test(rawPrice) ? Number(rawPrice).toFixed(2) : null;
    // A stale retained supplier_price is not given the latest quantity timestamp.
    // Explicit reviewer cost evidence applies only to that exact observed amount.
    const verified = cost && cost.amount === current && (cost.basis === "piece" || cost.basis === "pack")
      && typeof cost.verifiedAt === "string" && Number.isSafeInteger(cost.packSize);
    return {
      source: { supplier: s.supplier, sku: s.sku, productName: s.product_name, supplierStock: s.supplier_stock,
        supplierStatus: s.supplier_status, supplierUpdatedAt: s.supplier_updated_at, raw: s.imported_fields },
      cost: verified ? { amount: current!, currency: "USD", basis: cost.basis as "piece" | "pack", basisVerified: true,
        packSize: cost.packSize as number, observedAt: cost.verifiedAt as string } : null,
    };
  });
  return { mappings, offers };
}
function visibilityText(visibility: VariantSupplierVisibility) {
  const values = supplierVisibilityValues(visibility);
  return SUPPLIER_METAFIELD_KEYS.slice(1).map(key => values[key]);
}
export class MatrixifyWorkflow {
  readonly #previews = new Map<string, CachedExport>();
  constructor(private readonly repo: Pick<MappingApprovalRepository, "shop" | "readData">,
    private readonly configuration: () => Promise<MatrixifyConfiguration>,
    private readonly now: () => number = Date.now) {}
  async status() {
    const data = await this.repo.readData();
    const blockers: string[] = [];
    let cfg: MatrixifyConfiguration | null = null;
    try { cfg = await this.configuration(); } catch (e) { blockers.push(e instanceof WorkflowError ? e.code : "MATRIXIFY_CONFIGURATION_UNAVAILABLE"); }
    const catalogReady = data.catalog.length > 0 && data.catalog.every(c => catalogFresh(c.live_verified_at, this.now()));
    if (!catalogReady) blockers.push("CURRENT_RECONCILED_CATALOG_IMPORT_REQUIRED");
    return { catalogCount: data.catalog.length, catalogReady, policyReady: Boolean(cfg),
      pricingApproved: Boolean(cfg && cfg.policy.pricing.mode !== "preserve"),
      metafieldsReady: Boolean(cfg && privateMetafieldsReady(cfg, this.now())),
      locationName: cfg?.location.name ?? null, blockers, shopDomain: this.repo.shop,
      policySummary: cfg ? `COMBINE four eligible suppliers; buffer ${cfg.policy.safetyStock}; cap ${cfg.policy.maxQuantity}; pricing ${cfg.policy.pricing.mode}.` : "Owner-approved safety thresholds and verified location are not configured." };
  }
  async preview(raw: unknown, reviewer: MappingReviewer) {
    const parsed = matrixifyPreviewInput.safeParse(raw);
    if (!parsed.success) reject("INVALID_MATRIXIFY_PREVIEW_INPUT", 400);
    this.sweep();
    if ([...this.#previews.values()].filter(p => p.owner !== ownerKey(reviewer)).length >= 2)
      reject("PREVIEW_CAPACITY_RETRY_AFTER_EXPIRY", 429);
    const cfg = await this.configuration(), data = await this.repo.readData(), now = this.now();
    if (cfg.shopDomain !== this.repo.shop) reject("SHOP_BINDING_MISMATCH");
    if (!data.catalog.length || data.catalog.some(c => !catalogFresh(c.live_verified_at, now)))
      reject("CURRENT_RECONCILED_CATALOG_IMPORT_REQUIRED");
    const variants = parseMatrixifyBaseline(parsed.data.baselineCsv, data.catalog, cfg);
    const calculated = inputs(data);
    const selection = parsed.data.variantIds ? new Set(parsed.data.variantIds) : null;
    const availableIds = new Set(variants.map(v => v.variantId));
    if (selection && (selection.size !== parsed.data.variantIds!.length
      || [...selection].some(id => !availableIds.has(id)))) reject("INVALID_EXPORT_VARIANT_SELECTION", 400);
    const selectedMappings = selection ? calculated.mappings.filter(m => selection.has(m.variantId)) : calculated.mappings;
    const policy = exportPolicy(cfg);
    const plan = buildSyncPlan({ policy, snapshot: { shopDomain: cfg.shopDomain, currency: cfg.currency,
      scopes: [], verifiedAt: parsed.data.baselineObservedAt, complete: true, variants },
      mappings: selectedMappings, offers: calculated.offers, nowMs: now, target: "matrixify_export" });
    const inventory = new Map(plan.operations.filter(o => o.field === "inventory").map(o => [o.variantId, o.after as number]));
    const prices = new Map(plan.operations.filter(o => o.field === "price").map(o => [o.variantId, o.after as string]));
    const metadata = new Map<string, Record<string, string>>();
    if (privateMetafieldsReady(cfg, now)) {
      for (const visibility of plan.supplierVisibility) {
        // No automatic matching: only an independently approved, still eligible
        // relationship can attach any supplier information to this variant.
        if (visibility.suppliers.some(s => s.mappingStatus === "approved"))
          metadata.set(visibility.variantId, supplierVisibilityValues(visibility));
      }
    }
    const exceptions: MatrixifyException[] = plan.holds.filter(h => !selection || selection.has(h.variantId)).map(h => ({
      variantId: h.variantId, code: h.code, supplier: h.supplier ?? null, originalSku: h.originalSku ?? null,
    }));
    if (metadata.size > policy.maxChangedVariants) {
      metadata.clear();
      exceptions.push({ variantId: "", code: "METAFIELD_BATCH_CAP_EXCEEDED_SELECT_SMALLER_BATCH", supplier: null, originalSku: null });
    }
    if (selection) exceptions.push({ variantId: "", code: `CONTROLLED_BATCH_SELECTED_${selection.size}_OF_${variants.length}`, supplier: null, originalSku: null });
    const approvedSources = new Set(calculated.mappings.filter(m => m.state === "approved")
      .map(m => JSON.stringify([m.supplier, m.originalSku])));
    for (const s of data.sources) {
      const held = mappingHold(s.supplier, s.sku);
      if (held || !approvedSources.has(JSON.stringify([s.supplier, s.sku]))) exceptions.push({
        variantId: "", supplier: s.supplier, originalSku: s.sku,
        code: held ? "PROTECTED_SOURCE_HOLD" : "SUPPLIER_SOURCE_NOT_APPROVED",
      });
    }
    if (!privateMetafieldsReady(cfg, now)) exceptions.push({
      variantId: "", code: "PRIVATE_MATRIXIFY_METAFIELD_DEFINITIONS_NOT_VERIFIED", supplier: null, originalSku: null,
    });
    const visibility = new Map(plan.supplierVisibility.map(v => [v.variantId, v]));
    const titles = new Map(data.catalog.map(c => [c.variant_gid, c.title]));
    const rows = variants.filter(v => inventory.has(v.variantId) || prices.has(v.variantId) || metadata.has(v.variantId)).map(v => ({
      variantId: v.variantId, sku: v.sku, title: titles.get(v.variantId) ?? "",
      beforeQuantity: Number.isFinite(v.quantity) ? v.quantity : null, afterQuantity: inventory.get(v.variantId) ?? null,
      beforePrice: v.price, afterPrice: prices.get(v.variantId) ?? null,
      supplierSummary: visibility.has(v.variantId) ? visibilityText(visibility.get(v.variantId)!) : [],
    }));
    const entry: CachedExport = { id: randomUUID(), owner: ownerKey(reviewer), plan, config: cfg,
      configDigest: digest(cfg), sourceDigest: digest(data), variants, rows, exceptions, inventory, prices, metadata };
    // One active preview per reviewer bounds retained confidential baseline data.
    for (const [id, p] of this.#previews) if (p.owner === entry.owner) this.#previews.delete(id);
    this.#previews.set(entry.id, entry);
    return this.page(entry.id, reviewer);
  }
  page(id: string, reviewer: MappingReviewer, page = 1, view = "changes") {
    const entry = this.owned(id, reviewer);
    if (!Number.isSafeInteger(page) || page < 1 || !["changes", "exceptions"].includes(view)) reject("INVALID_PREVIEW_PAGE", 400);
    const totalRows = view === "changes" ? entry.rows.length : entry.exceptions.length, totalPages = Math.max(1, Math.ceil(totalRows / 100));
    if (page > totalPages) reject("INVALID_PREVIEW_PAGE", 400);
    const start = (page - 1) * 100;
    return { id: entry.id, digest: entry.plan.digest, expiresAt: entry.plan.expiresAt, shopDomain: entry.plan.shopDomain,
      locationName: entry.config.location.name, blockers: [...entry.plan.blockers],
      counts: { variants: entry.variants.length, inventoryRows: entry.inventory.size, metafieldRows: entry.metadata.size,
        priceRows: entry.prices.size, exceptions: entry.exceptions.length },
      page, totalPages, totalRows, rows: view === "changes" ? entry.rows.slice(start, start + 100) : [],
      exceptions: view === "exceptions" ? entry.exceptions.slice(start, start + 100) : [], warnings };
  }
  async download(raw: unknown, reviewer: MappingReviewer, output: Writable) {
    const parsed = matrixifyDownloadInput.safeParse(raw);
    if (!parsed.success) reject("INVALID_MATRIXIFY_DOWNLOAD_INPUT", 400);
    const { previewId, digest: requestedDigest, profile } = parsed.data;
    const entry = this.owned(previewId, reviewer);
    assertGeneratedSyncPlan(entry.plan);
    if (entry.plan.target !== "matrixify_export" || entry.plan.digest !== requestedDigest) reject("PREVIEW_DIGEST_MISMATCH");
    if (entry.plan.blockers.length) reject("EXPORT_BLOCKED");
    const config = await this.configuration();
    const data = await this.repo.readData();
    if (digest(config) !== entry.configDigest || digest(data) !== entry.sourceDigest) reject("PREVIEW_INPUTS_CHANGED_REVIEW_AGAIN");
    if (Date.parse(entry.plan.expiresAt) <= this.now()) reject("PREVIEW_EXPIRED");
    const count = profile === "inventory" ? entry.inventory.size : profile === "prices" ? entry.prices.size : entry.metadata.size;
    if (!count) reject(profile === "prices" ? "NO_APPROVED_PRICE_UPDATES" : "NO_ELIGIBLE_EXPORT_ROWS");
    if (profile === "supplier_metafields" && !privateMetafieldsReady(config, this.now())) reject("PRIVATE_METAFIELD_EVIDENCE_REQUIRED");
    await writeMatrixifyWorkbook(entry, profile, output, reviewer);
  }
  private owned(id: string, reviewer: MappingReviewer) {
    this.sweep();
    const entry = this.#previews.get(id);
    if (!entry || entry.owner !== ownerKey(reviewer)) reject("PREVIEW_NOT_FOUND_OR_EXPIRED", 404);
    if (Date.parse(entry.plan.expiresAt) <= this.now()) reject("PREVIEW_EXPIRED");
    return entry;
  }
  private sweep() {
    for (const [id, entry] of this.#previews) if (Date.parse(entry.plan.expiresAt) <= this.now()) this.#previews.delete(id);
  }
}
async function writeMatrixifyWorkbook(entry: CachedExport, profile: ExportProfile, output: Writable, reviewer: MappingReviewer) {
  const book = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useStyles: true, useSharedStrings: false });
  book.creator = "TSH Inventory Sync";
  const products = book.addWorksheet("Products");
  const fields = profile === "inventory" ? [`Inventory Available: ${entry.config.location.name}`]
    : profile === "prices" ? ["Variant Price"]
    : SUPPLIER_METAFIELD_KEYS.map((key, i) => `Variant Metafield: ${MATRIXIFY_NAMESPACE}.${key} [${i === 0 ? "json" : "multi_line_text_field"}]`);
  products.addRow(["ID", "Command", "Variant ID", "Variant Command", ...fields]).commit();
  for (const v of entry.variants) {
    const include = profile === "inventory" ? entry.inventory.has(v.variantId)
      : profile === "prices" ? entry.prices.has(v.variantId) : entry.metadata.has(v.variantId);
    if (!include) continue;
    const values = profile === "inventory" ? [entry.inventory.get(v.variantId)!]
      : profile === "prices" ? [entry.prices.get(v.variantId)!]
      : SUPPLIER_METAFIELD_KEYS.map(key => entry.metadata.get(v.variantId)![key]);
    const row = products.addRow([shopifyNumericId(v.productId, "Product"), "UPDATE",
      shopifyNumericId(v.variantId, "ProductVariant"), "UPDATE", ...values]);
    row.getCell(1).numFmt = "@"; row.getCell(3).numFmt = "@";
    if (profile === "prices") row.getCell(5).numFmt = "@";
    row.commit();
  }
  products.commit();
  const exceptions = book.addWorksheet("TSH Exceptions");
  exceptions.addRow(["Diagnostic variant GID", "Reason code", "Supplier", "Original supplier SKU"]).commit();
  for (const e of entry.exceptions) exceptions.addRow([e.variantId, e.code, e.supplier ?? "", e.originalSku ?? ""]).commit();
  exceptions.commit();
  const review = book.addWorksheet("TSH Review");
  for (const row of [
    ["Export purpose", profile], ["Shop", entry.plan.shopDomain], ["Inventory location", entry.config.location.name],
    ["Location GID", entry.config.location.id], ["Preview digest", entry.plan.digest],
    ["Policy digest", entry.plan.policyDigest], ["Input digest", entry.plan.inputDigest],
    ["Created", entry.plan.createdAt], ["Valid until", entry.plan.expiresAt],
    ["Reviewer issuer", reviewer.issuer], ["Reviewer subject", reviewer.subject],
    ["Approved pricing rule", JSON.stringify(entry.config.policy.pricing)],
    ["Policy approved by", entry.config.approvedBy], ["Policy approved at", entry.config.approvedAt],
    ...warnings.map(w => ["Warning", w]),
  ]) review.addRow(row).commit();
  review.commit();
  await book.commit();
}
