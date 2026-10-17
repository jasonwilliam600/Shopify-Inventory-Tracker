import { Router, type IRouter } from "express";
import { and, inArray, or, sql } from "drizzle-orm";
import { db, supplierInventoryTable as t } from "@workspace/db";
import { ListSupplierAvailabilityQueryParams, ListSupplierAvailabilityResponse } from "@workspace/api-zod";
import { mappedStoreSkuExpression } from "../lib/sku-mapping";
import { AVAILABILITY_SUPPLIERS, evaluateSupplierAvailability } from "../lib/supplier-availability";
import { loadAvailabilityCatalog } from "../lib/supplier-availability-catalog";

const router: IRouter = Router();
router.get("/supplier-availability", async (req, res): Promise<void> => {
  const parsed = ListSupplierAvailabilityQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid supplier availability query." });
    return;
  }
  try {
    const { search = "", issue = "all", page = 1, pageSize = 10 } = parsed.data;
    const catalog = await loadAvailabilityCatalog();
    const term = search.trim().toLocaleLowerCase();
    const filtered = catalog.variants.filter(variant =>
      (issue === "all" || variant.skuStatus === issue)
      && (!term || [variant.sku, variant.title, variant.handle, ...variant.options].some(value => value.toLocaleLowerCase().includes(term))));
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const currentPage = Math.min(page, totalPages);
    const variants = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    const skus = [...new Set(variants.map(variant => variant.sku).filter(Boolean))];
    // SELECT only. Never read legacy shopify_stock as real Shopify inventory.
    const sources = skus.length ? await db.select({
      sku: t.sku, supplier: t.supplier, supplierStock: t.supplierStock,
      supplierStatus: t.supplierStatus, supplierUpdatedAt: t.supplierUpdatedAt,
      raw: sql<Record<string, unknown>>`jsonb_build_object(
        'On Hand', ${t.importedFields}->'On Hand',
        'ZCMQOH', ${t.importedFields}->'ZCMQOH',
        'quantityavailable', ${t.importedFields}->'quantityavailable',
        'Stock Level', ${t.importedFields}->'Stock Level',
        'quantitySource', ${t.importedFields}->'quantitySource',
        'dealerStock', ${t.importedFields}#>'{dealerCatalogRecord,stock}'
      )`,
    }).from(t).where(and(
      inArray(t.supplier, [...AVAILABILITY_SUPPLIERS]),
      or(inArray(mappedStoreSkuExpression(t.sku, t.supplier, { includeReview: true }), skus), inArray(sql<string>`trim(${t.sku})`, skus)),
    )).limit(2001) : [];
    if (sources.length > 2000) throw new Error("AVAILABILITY_TOO_MANY_COLLISIONS");
    res.setHeader("Cache-Control", "no-store");
    res.json(ListSupplierAvailabilityResponse.parse({
      items: evaluateSupplierAvailability(variants, sources, catalog.knownSkus),
      total: filtered.length, page: currentPage, pageSize, totalPages, catalog: catalog.metadata,
    }));
  } catch {
    // No credentials, source payloads, or database URLs in error responses/logs.
    req.log.warn("Read-only supplier availability is temporarily unavailable");
    res.status(503).json({ error: "Supplier availability could not be safely evaluated. No inventory has been changed." });
  }
});
export default router;
