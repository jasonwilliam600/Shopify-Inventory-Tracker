import type { MappingCapabilities, SkuMappingRow } from "@workspace/api-zod";
import { db, supplierInventoryTable as t } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";
import { loadAvailabilityCatalog } from "./supplier-availability-catalog";
import { AVAILABILITY_SUPPLIERS, DISPLAY_FRESHNESS_MINUTES, quantityObservation, sourceCandidates } from "./supplier-availability";
import { mappingDiagnostics } from "./sku-mapping";
import { COLLISION_HISTORY_SOURCES } from "./supplier-mapping-policy";

export const MAPPING_CAPABILITIES: MappingCapabilities = {
  canSave: false, canApprove: false, liveCatalogAvailable: false,
  scopesVerified: false, grantedScopes: [],
  blockers: [
    "Mapping schema is installed. Permanent Save/Approve remain disabled pending reviewer authentication and transactional approval APIs.",
    "Verified reviewer identity and authorized, audited approval endpoints are not installed.",
    "Live catalog blocked: the existing connection exposes connectivity only. Agent integration policy prevents extending its direct Admin authentication path; installed scopes have not been verified. The connection and permissions were not changed.",
    "October 5 historical results are preview only: no live Shopify variant IDs or selling-unit verification.",
  ],
};
let cached: { at: number; rows: SkuMappingRow[] } | undefined;
let pending: Promise<SkuMappingRow[]> | undefined;

/** SELECT-only projection. No importer, auth client, scheduler, or mutation is called. */
async function buildRows(): Promise<SkuMappingRow[]> {
  const catalog = await loadAvailabilityCatalog();
  const sources = await db.select({
    sku: t.sku, supplier: t.supplier, productName: t.productName,
    supplierStock: t.supplierStock, supplierStatus: t.supplierStatus,
    supplierUpdatedAt: t.supplierUpdatedAt,
    raw: sql<Record<string, unknown>>`jsonb_build_object(
      'On Hand', ${t.importedFields}->'On Hand',
      'ZCMQOH', ${t.importedFields}->'ZCMQOH',
      'quantityavailable', ${t.importedFields}->'quantityavailable',
      'Stock Level', ${t.importedFields}->'Stock Level',
      'quantitySource', ${t.importedFields}->'quantitySource',
      'dealerStock', ${t.importedFields}#>'{dealerCatalogRecord,stock}')`,
  }).from(t).where(inArray(t.supplier, [...AVAILABILITY_SUPPLIERS]));
  const bySku = new Map<string, typeof catalog.variants>();
  for (const v of catalog.variants) if (v.sku) {
    const entries = bySku.get(v.sku) ?? [];
    entries.push(v); bySku.set(v.sku, entries);
  }
  const candidates = sources.map(s => sourceCandidates(s, catalog.knownSkus));
  const collisions = new Map<string, number>();
  sources.forEach((s, i) => {
    for (const c of candidates[i]) {
      const key = `${s.supplier}\0${c.sku}`;
      collisions.set(key, (collisions.get(key) ?? 0) + 1);
    }
  });
  const now = Date.now();
  return sources.map((s, i): SkuMappingRow => {
    const diagnostic = mappingDiagnostics(s.sku, s.supplier);
    const cs = candidates[i];
    const skus = [...new Set(cs.map(c => c.sku))];
    const warnings: string[] = [];
    const duplicate = skus.some(sku => (bySku.get(sku)?.length ?? 0) > 1);
    const collision = skus.some(sku => (collisions.get(`${s.supplier}\0${sku}`) ?? 0) > 1);
    const history = s.supplier === "MMD/Squadron" && COLLISION_HISTORY_SOURCES.has(s.sku.trim().toUpperCase());
    if (duplicate) warnings.push("Duplicate historical Shopify SKU: variant identity is ambiguous.");
    if (skus.length > 1) warnings.push("Multiple plausible catalog identifiers require individual product review.");
    if (collision) warnings.push("Same-supplier collision. Never add overlapping offers.");
    if (history) warnings.push("Known CP collision history requires individual review; rejected competitors disappearing is not approval.");
    if (diagnostic.rule?.decision === "REVIEW" && cs.some(c => c.method === "prefix")) {
      warnings.push("REVIEW prefix rule: diagnostic discovery only, never verified availability.");
    }
    if (diagnostic.rule?.decision === "REMOVE") warnings.push("Generated alias removed; old transformation is retained only as diagnostic evidence.");
    warnings.push("Product identity and retail selling unit require explicit verification against a current variant.");
    const status = diagnostic.hold ? diagnostic.hold.status === "rejected" ? "rejected" : "flagged"
      : duplicate || collision || history || skus.length > 1 ? "ambiguous"
      : skus.length ? "candidate" : "unmatched";
    const quantity = quantityObservation(s);
    const imported = s.supplierUpdatedAt ? new Date(s.supplierUpdatedAt) : null;
    const valid = imported !== null && Number.isFinite(imported.getTime());
    const age = valid ? now - imported.getTime() : null;
    const freshness = age === null || age < -300_000 ? "unknown"
      : age > DISPLAY_FRESHNESS_MINUTES[s.supplier] * 60_000 ? "stale" : "fresh";
    return {
      supplier: s.supplier, originalSku: s.sku, suggestedSkus: skus,
      diagnosticSkus: diagnostic.legacyTarget ? [diagnostic.legacyTarget] : [],
      supplierQuantity: quantity.reportedQuantity, quantityText: quantity.quantityText,
      quantityKind: quantity.quantityKind, availability: quantity.availability,
      freshness, lastFeedImport: valid ? imported.toISOString() : null,
      mappingStatus: status, reason: diagnostic.hold?.reason
        ?? (status === "unmatched" ? "Awaiting comparison: no active candidate in the historical catalog."
          : "Historical candidate only; no live variant or selling-unit approval."),
      supplierProductName: s.productName || null,
      shopifyTitles: [...new Set(skus.flatMap(sku => (bySku.get(sku) ?? []).map(v => v.title)))],
      trusted: false, publishable: false, ruleDecision: diagnostic.rule?.decision ?? null, warnings,
    };
  });
}
export async function mappingManagerRows() {
  if (cached && Date.now() - cached.at < 30_000) return cached.rows;
  if (!pending) pending = buildRows().then(rows => {
    cached = { at: Date.now(), rows }; return rows;
  }).finally(() => { pending = undefined; });
  return pending;
}
