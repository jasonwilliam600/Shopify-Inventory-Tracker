import { Router, type Response, type RequestHandler } from "express";
import type { ImportPool } from "../lib/shopify-catalog-importer";
import { MappingApprovalRepository, configuredShop, catalogFresh, supplierIdentityFingerprint } from "../lib/mapping-approval";
import { MatrixifyWorkflow } from "../lib/matrixify-workflow";
import { loadMatrixifyConfiguration, type MatrixifyConfiguration } from "../lib/matrixify-configuration";
import { reviewerSession, requireMappingReviewer, workflowError, type MappingReviewer } from "../lib/reviewer-authorization";
import { mappingManagerRows, invalidateMappingManagerRows } from "../lib/mapping-manager";
import { mappingHold } from "../lib/supplier-mapping-policy";
import type { AvailabilityCatalog } from "../lib/supplier-availability-catalog";

/** Factory accepts isolated resources; construction does not query any database. */
export function createMappingWorkflowRouter(options: {
  pool: ImportPool; shop?: () => string; configuration?: () => Promise<MatrixifyConfiguration>;
  guard?: RequestHandler; session?: typeof reviewerSession;
}) {
  const router = Router(), guard = options.guard ?? requireMappingReviewer;
  let service: { repo: MappingApprovalRepository; matrixify: MatrixifyWorkflow } | undefined;
  const services = () => {
    const shop = (options.shop ?? configuredShop)();
    if (!service || service.repo.shop !== shop) {
      const repo = new MappingApprovalRepository(options.pool, shop);
      service = { repo, matrixify: new MatrixifyWorkflow(repo, options.configuration ?? loadMatrixifyConfiguration) };
    }
    return service;
  };
  const reviewer = (res: Response) => res.locals.mappingReviewer as MappingReviewer;
  const session = options.session ?? reviewerSession;
  router.get("/reviewer/session", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(session(req));
  });
  router.get("/sku-mappings/capabilities", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const auth = session(req);
      if (!auth.authorized) {
        res.json({ canSave: false, canApprove: false, liveCatalogAvailable: false,
          scopesVerified: false, grantedScopes: [], blockers: [auth.message,
            "Historical candidates are diagnostic only. All 209 source holds remain protected."] }); return;
      }
      const data = await services().repo.readData();
      const ready = data.catalog.length > 0 && data.catalog.every(c => catalogFresh(c.live_verified_at));
      res.json({ canSave: ready, canApprove: ready, liveCatalogAvailable: ready, scopesVerified: false, grantedScopes: [],
        blockers: ready ? [] : ["A current, independently reconciled catalog must be imported with separate owner approval. No catalog import or Shopify request is executed here."] });
    } catch (e) { workflowError(res, e); }
  });
  router.get("/sku-mappings/catalog", (req, res, next) => {
    if (req.query.source !== "live") { next(); return; }
    guard(req, res, async () => {
      try {
        const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
        if (search.length < 2 || search.length > 200) { res.status(400).json({ code: "INVALID_CATALOG_SEARCH" }); return; }
        const data = await services().repo.readData();
        const ready = data.catalog.length > 0 && data.catalog.every(c => catalogFresh(c.live_verified_at));
        if (!ready) { res.status(503).json({ code: "CURRENT_RECONCILED_CATALOG_REQUIRED" }); return; }
        const counts = new Map<string, number>();
        for (const c of data.catalog) {
          const key = c.sku?.trim().toUpperCase() ?? "";
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        const items = data.catalog.filter(c => `${c.sku ?? ""} ${c.title} ${c.vendor ?? ""} ${JSON.stringify(c.selected_options)}`.toLowerCase().includes(search))
          .slice(0, 50).map(c => ({
            key: c.variant_gid, variantId: c.variant_gid, productId: c.product_gid, inventoryItemId: c.inventory_item_gid,
            sku: c.sku ?? "", title: c.title, vendor: c.vendor ?? "", options: c.selected_options.map(o => o.value),
            skuStatus: !c.sku?.trim() ? "missing" : (counts.get(c.sku.trim().toUpperCase()) ?? 0) > 1 ? "duplicate" : "unique",
            historical: false, verifiedAt: new Date(c.live_verified_at).toISOString(), identityFingerprint: c.identity_fingerprint,
          }));
        res.json({ items, source: "live", verified: true, blocker: null });
      } catch (e) { workflowError(res, e); }
    });
  });
  router.get("/sku-mappings", async (req, res, next) => {
    if (!session(req).authorized) { next(); return; }
    res.setHeader("Cache-Control", "no-store");
    try {
      const data = await services().repo.readData();
      const ready = data.catalog.length > 0 && data.catalog.every(c => catalogFresh(c.live_verified_at));
      // Never replace a verified cache with the historical export for approval.
      const skuCounts = new Map<string, number>();
      for (const c of data.catalog) {
        const key = c.sku?.trim().toUpperCase() ?? "";
        skuCounts.set(key, (skuCounts.get(key) ?? 0) + 1);
      }
      const variants: AvailabilityCatalog["variants"] = data.catalog.map(c => ({
        key: c.variant_gid, variantId: c.variant_gid, sku: c.sku ?? "", title: c.title, handle: "",
        vendor: c.vendor ?? "", options: c.selected_options.map(o => o.value),
        skuStatus: !c.sku?.trim() ? "missing" : (skuCounts.get(c.sku.trim().toUpperCase()) ?? 0) > 1 ? "duplicate" : "unique",
      }));
      const variantStatuses = new Map(variants.map(v => [v.variantId, v.skuStatus]));
      const catalog = { variants, knownSkus: new Set(variants.map(v => v.sku).filter(Boolean)) };
      const baseRows = await mappingManagerRows(data.catalog.length ? catalog : undefined);
      const decisions = new Map(data.decisions.map(d => [JSON.stringify([d.supplier_id, d.original_supplier_sku]), d]));
      const sourceMap = new Map(data.sources.map(s => [JSON.stringify([s.supplier, s.sku]), s]));
      const byId = new Map(data.catalog.map(v => [v.variant_gid, v]));
      const allRows = baseRows.map(row => {
        const d = decisions.get(JSON.stringify([row.supplier, row.originalSku]));
        const c = d ? byId.get(d.variant_gid) : null;
        const source = sourceMap.get(JSON.stringify([row.supplier, row.originalSku]));
        const trusted = Boolean(ready && d?.state === "approved" && c?.active && c.sku?.trim()
          && variantStatuses.get(c.variant_gid) === "unique"
          && !mappingHold(row.supplier, row.originalSku)
          && d.product_identity_snapshot.identity_fingerprint === c.identity_fingerprint
          && d.selling_unit_snapshot.confirmed === true && d.selling_unit_snapshot.retail_units_per_supplier_unit === 1
          && source && d.selling_unit_snapshot.sourceIdentityFingerprint === supplierIdentityFingerprint(source));
        const amount = sourceMap.get(JSON.stringify([row.supplier, row.originalSku]))?.supplier_price;
        return { ...row, ...(trusted ? { mappingStatus: "approved" as const, trusted: true,
          publishable: false, reason: "Audited exact-source approval matches the verified catalog snapshot. Shopify writes remain disabled.",
          suggestedSkus: c?.sku ? [c.sku] : [], warnings: row.warnings.filter(w => !/no live|not verified|historical/i.test(w)) } : {}),
          decisionId: d?.id ?? null, decisionVersion: d ? Number(d.version) : null, approvedVariantId: d?.variant_gid ?? null,
          supplierProductName: source?.product_name ?? row.supplierProductName,
          sourceIdentityFingerprint: source ? supplierIdentityFingerprint(source) : null,
          identityFingerprint: c?.identity_fingerprint ?? null, costAmount: typeof amount === "number" && amount > 0 ? amount.toFixed(2) : null };
      });
      const search = String(req.query.search ?? "").toLowerCase(), supplier = String(req.query.supplier ?? "");
      const status = String(req.query.status ?? "all");
      const rows = allRows.filter(row => (!supplier || row.supplier === supplier)
        && (status === "all" || row.mappingStatus === status)
        && (!search || `${row.originalSku} ${row.supplierProductName ?? ""} ${row.suggestedSkus.join(" ")}`.toLowerCase().includes(search)));
      const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
      const totalPages = Math.max(1, Math.ceil(rows.length / pageSize)), page = Math.min(totalPages, Math.max(1, Number(req.query.page) || 1));
      const counts: Record<string, number> = {};
      for (const row of allRows) counts[row.mappingStatus] = (counts[row.mappingStatus] ?? 0) + 1;
      res.json({ items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, totalPages,
        counts, catalogLabel: data.catalog.length ? "Verified local catalog snapshot; manually audited source approvals. No live Shopify request." : "Historical catalog — diagnostic candidates only." });
    } catch (e) { workflowError(res, e); }
  });
  router.post("/sku-mappings/approve", guard, async (req, res) => {
    try {
      const result = await services().repo.approve(req.body, reviewer(res));
      invalidateMappingManagerRows(); res.json(result);
    } catch (e) { workflowError(res, e); }
  });
  router.post("/sku-mappings/revoke", guard, async (req, res) => {
    try {
      const result = await services().repo.revoke(req.body, reviewer(res));
      invalidateMappingManagerRows(); res.json(result);
    } catch (e) { workflowError(res, e); }
  });
  router.get("/matrixify/status", guard, async (_req, res) => {
    try { res.json(await services().matrixify.status()); } catch (e) { workflowError(res, e); }
  });
  router.post("/matrixify/preview", guard, async (req, res) => {
    try { res.json(await services().matrixify.preview(req.body, reviewer(res))); } catch (e) { workflowError(res, e); }
  });
  router.get("/matrixify/preview", guard, (req, res) => {
    try { res.json(services().matrixify.page(String(req.query.previewId ?? ""), reviewer(res), Number(req.query.page ?? 1), String(req.query.view ?? "changes"))); }
    catch (e) { workflowError(res, e); }
  });
  router.post("/matrixify/download", guard, async (req, res) => {
    // Validate before sending headers. WorkbookWriter writes headers lazily.
    const { PassThrough } = await import("node:stream");
    const output = new PassThrough();
    let started = false;
    const errorListener = () => { if (!output.destroyed) output.destroy(); };
    res.on("close", errorListener);
    output.once("data", first => {
      started = true;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="tsh-matrixify-${["inventory", "supplier_metafields", "prices"].includes(req.body?.profile) ? req.body.profile : "export"}.xlsx"`);
      res.setHeader("Cache-Control", "no-store");
      res.write(first);
      output.pipe(res);
    });
    try { await services().matrixify.download(req.body, reviewer(res), output); }
    catch (e) {
      output.destroy();
      if (started) res.destroy(); else workflowError(res, e);
    } finally { res.off("close", errorListener); }
  });
  return router;
}
