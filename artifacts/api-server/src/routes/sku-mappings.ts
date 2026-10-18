import { Router, type IRouter } from "express";
import {
  GetSkuMappingCapabilitiesResponse, ListSkuMappingRowsQueryParams, ListSkuMappingRowsResponse,
  SearchMappingCatalogQueryParams, SearchMappingCatalogResponse,
} from "@workspace/api-zod";
import { MAPPING_CAPABILITIES, mappingManagerRows } from "../lib/mapping-manager";
import { loadAvailabilityCatalog } from "../lib/supplier-availability-catalog";
import { mappingStorageBlocker } from "../lib/mapping-storage-status";
import { matchesMappingReview } from "../lib/mapping-review-filter";

const router: IRouter = Router();
// Fail closed even if a client bypasses disabled controls. No approval writer exists.
router.use("/sku-mappings", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).json({ code: "MAPPING_APPROVAL_DISABLED", error: "Read-only preview. Reviewer authorization, transactional approvals and live variant verification are not enabled." });
    return;
  }
  next();
});
router.get("/sku-mappings/capabilities", async (_req, res) => {
  const storageBlocker = await mappingStorageBlocker();
  res.json(GetSkuMappingCapabilitiesResponse.parse({
    ...MAPPING_CAPABILITIES, blockers: [storageBlocker, ...MAPPING_CAPABILITIES.blockers.slice(1)],
  }));
});
router.get("/sku-mappings/catalog", async (req, res): Promise<void> => {
  const p = SearchMappingCatalogQueryParams.safeParse(req.query);
  if (!p.success) { res.status(400).json({ error: "Search requires at least two characters; source must be historical or live." }); return; }
  if (p.data.source === "live") {
    res.status(503).json({ code: "LIVE_CATALOG_BLOCKED", error: MAPPING_CAPABILITIES.blockers[2] });
    return;
  }
  try {
    const catalog = await loadAvailabilityCatalog();
    const term = (p.data.search ?? "").trim().toLocaleLowerCase();
    const matches = term.length < 2 ? [] : catalog.variants.filter(v =>
      [v.sku, v.title, v.vendor ?? "", v.handle, ...v.options].some(x => x.toLocaleLowerCase().includes(term)));
    res.json(SearchMappingCatalogResponse.parse({
      items: matches.slice(0, 50).map(v => ({
        key: v.key, variantId: null, sku: v.sku, title: v.title,
        vendor: v.vendor ?? "", options: v.options, skuStatus: v.skuStatus, historical: true,
      })),
      total: matches.length, source: "historical", verified: false,
      blocker: "October 5 preview only. Local historical keys are not Shopify variant IDs and cannot be approved.",
    }));
  } catch {
    req.log.warn("Historical mapping catalog unavailable");
    res.status(503).json({ error: "Historical catalog preview unavailable; no live catalog was requested." });
  }
});
router.get("/sku-mappings", async (req, res): Promise<void> => {
  const p = ListSkuMappingRowsQueryParams.safeParse(req.query);
  if (!p.success) { res.status(400).json({ error: "Invalid mapping review filters or pagination." }); return; }
  try {
    const { search = "", supplier = "", status = "all", page = 1, pageSize = 25 } = p.data;
    const rows = await mappingManagerRows();
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.mappingStatus] = (counts[row.mappingStatus] ?? 0) + 1;
    const term = search.trim().toLocaleLowerCase();
    const filtered = rows.filter(r => (!supplier || r.supplier === supplier)
      && matchesMappingReview(r, status)
      && (!term || [r.originalSku, r.supplierProductName ?? "", ...r.suggestedSkus, ...r.diagnosticSkus, ...r.shopifyTitles]
        .some(x => x.toLocaleLowerCase().includes(term))));
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const current = Math.min(page, totalPages);
    res.json(ListSkuMappingRowsResponse.parse({
      items: filtered.slice((current - 1) * pageSize, current * pageSize),
      total: filtered.length, page: current, pageSize, totalPages, counts,
      catalogLabel: "October 5, 2026 historical catalog — preview only; no live variant approval",
    }));
  } catch {
    req.log.warn("Read-only mapping manager unavailable");
    res.status(503).json({ error: "Mapping review is temporarily unavailable. No supplier data or mappings were changed." });
  }
});
export default router;
