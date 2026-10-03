import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db, supplierInventoryTable, suppliersTable } from "@workspace/db";
import {
  ListInventoryGroupsQueryParams, ListInventoryGroupsResponse,
  GetInventoryGroupParams, GetInventoryGroupResponse,
} from "@workspace/api-zod";
import { mappedStoreSkuExpression } from "../lib/sku-mapping";
import { groupDistributorOffers, INVENTORY_PUBLISHING_STATE, type GroupOffer } from "../lib/inventory-groups";

const router: IRouter = Router();
const t = supplierInventoryTable;

// Compute keys before searching/paging, so every selected product retains all
// its distributors. Unknown mappings stay isolated by supplier AND source SKU.
function offersCte() {
  return sql`WITH normalized AS MATERIALIZED (
    SELECT ${t.sku} AS sku, ${t.supplier} AS supplier,
      ${t.productName} AS "productName", ${t.variant} AS variant,
      ${t.supplierStock} AS "supplierStock", ${t.supplierStatus} AS "supplierStatus",
      ${t.supplierUpdatedAt} AS "supplierUpdatedAt", ${t.supplierPrice} AS "supplierPrice",
      ${t.importedFields}->>'manufacturerName' AS "manufacturerName",
      coalesce(${t.importedFields}->>'On Hand', ${t.importedFields}->>'ZCMQOH', '') AS "stockText",
      ${mappedStoreSkuExpression(t.sku, t.supplier)} AS "mappedStoreSku"
    FROM ${t}
  ), offers AS MATERIALIZED (
    SELECT *, CASE WHEN "mappedStoreSku" IS NOT NULL THEN 'sku:' || "mappedStoreSku"
      ELSE 'source:' || jsonb_build_array(supplier, sku)::text END AS "groupKey"
    FROM normalized
  )`;
}

async function supplierNames() {
  return (await db.select({ name: suppliersTable.name }).from(suppliersTable).orderBy(suppliersTable.name)).map((s) => s.name);
}

router.get("/inventory-groups", async (req, res): Promise<void> => {
  const parsed = ListInventoryGroupsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { search, supplier, status = "all", page = 1, pageSize = 25 } = parsed.data;
  const term = search ? `%${search.trim().replace(/[\\%_]/g, "\\$&")}%` : null;
  const match = term ? sql`bool_or(sku ILIKE ${term} OR "mappedStoreSku" ILIKE ${term}
    OR "productName" ILIKE ${term} OR variant ILIKE ${term})` : sql`true`;
  const supplierMatch = supplier ? sql`bool_or(supplier = ${supplier})` : sql`true`;
  const [result, suppliers] = await Promise.all([
    db.execute(sql`${offersCte()}, grouped AS (
      SELECT "groupKey", min(coalesce("mappedStoreSku", sku)) AS "sortSku",
        ${match} AS matches, ${supplierMatch} AS "supplierMatches",
        CASE WHEN count(*) <> count(DISTINCT supplier)
          OR bool_or("mappedStoreSku" IS NULL)
          OR bool_or("supplierStatus" <> 'unavailable' AND (
            "supplierStock" IS NULL OR "supplierStock" < 0 OR "supplierStatus" NOT IN ('available', 'low')))
          THEN 'review'
          WHEN sum(CASE WHEN "supplierStatus" = 'unavailable' THEN 0 ELSE coalesce("supplierStock", 0) END) = 0
          THEN 'unavailable' ELSE 'available' END AS status
      FROM offers GROUP BY "groupKey"
    ), filtered AS (
      SELECT * FROM grouped WHERE matches AND "supplierMatches"
        AND (${status} = 'all' OR status = ${status})
    ), metadata AS (
      SELECT count(*)::int AS total,
        greatest(1, ceil(count(*)::numeric / ${pageSize}))::int AS "totalPages",
        least(${page}, greatest(1, ceil(count(*)::numeric / ${pageSize})))::int AS page
      FROM filtered
    ), selected AS (
      SELECT "groupKey" FROM filtered ORDER BY "sortSku", "groupKey"
      LIMIT ${pageSize} OFFSET (SELECT (page - 1) * ${pageSize} FROM metadata)
    )
    SELECT metadata.*,
      coalesce(jsonb_agg(to_jsonb(o) ORDER BY coalesce(o."mappedStoreSku", o.sku), o."groupKey", o.sku, o.supplier)
        FILTER (WHERE o."groupKey" IS NOT NULL), '[]'::jsonb) AS offers
    FROM metadata LEFT JOIN (offers o INNER JOIN selected USING ("groupKey")) ON true
    GROUP BY metadata.total, metadata."totalPages", metadata.page`),
    supplierNames(),
  ]);
  const row = result.rows[0] as { total: number; totalPages: number; page: number; offers: GroupOffer[] };
  res.json(ListInventoryGroupsResponse.parse({
    items: groupDistributorOffers(row.offers, suppliers),
    total: row.total, totalPages: row.totalPages, page: row.page, pageSize,
    suppliers, publishing: INVENTORY_PUBLISHING_STATE,
  }));
});

router.get("/inventory-groups/:groupKey", async (req, res): Promise<void> => {
  const parsed = GetInventoryGroupParams.safeParse(req.params);
  if (!parsed.success || parsed.data.groupKey.length > 1200) {
    res.status(400).json({ error: "Invalid inventory group identifier" });
    return;
  }
  const [result, suppliers] = await Promise.all([
    db.execute(sql`${offersCte()}
      SELECT * FROM offers WHERE "groupKey" = ${parsed.data.groupKey} ORDER BY sku, supplier`),
    supplierNames(),
  ]);
  const [item] = groupDistributorOffers(result.rows as unknown as GroupOffer[], suppliers);
  if (!item) {
    res.status(404).json({ error: "Inventory group not found" });
    return;
  }
  res.json(GetInventoryGroupResponse.parse({ item, publishing: INVENTORY_PUBLISHING_STATE }));
});

export default router;