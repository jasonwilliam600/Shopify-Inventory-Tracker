import { Router, type IRouter, type RequestHandler } from "express";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  db,
  inventoryActivityTable,
  inventoryItemsTable,
  suppliersTable,
  type InventoryItemRecord,
} from "@workspace/db";
import {
  GetDashboardResponse,
  GetInventoryItemParams,
  GetInventoryItemResponse,
  ImportSupplierUpdateBody,
  ImportSupplierUpdateResponse,
  ListActivityResponse,
  ListInventoryQueryParams,
  ListInventoryResponse,
  ListSuppliersResponse,
  ReviewInventoryItemBody,
  ReviewInventoryItemParams,
  ReviewInventoryItemResponse,
} from "@workspace/api-zod";
import { refreshHobbyTymeInventory } from "../lib/hobbytyme";

const router: IRouter = Router();
const supplierMutationAttempts = new Map<
  string,
  { count: number; resetAt: number }
>();

const requireSupplierMutationAccess: RequestHandler = (req, res, next) => {
  const origin = req.get("origin");
  const host = req.get("host");
  let sameOrigin = false;
  try {
    sameOrigin = Boolean(origin && host && new URL(origin).host === host);
  } catch {
    sameOrigin = false;
  }

  if (req.get("x-inventory-action") !== "web" || !sameOrigin) {
    res.status(403).json({ error: "Supplier updates require app access" });
    return;
  }

  const key = req.ip ?? "unknown";
  const now = Date.now();
  const current = supplierMutationAttempts.get(key);
  const attempt =
    !current || current.resetAt <= now
      ? { count: 1, resetAt: now + 60_000 }
      : { count: current.count + 1, resetAt: current.resetAt };
  supplierMutationAttempts.set(key, attempt);

  if (attempt.count > 10) {
    res.status(429).json({ error: "Too many supplier update requests" });
    return;
  }

  next();
};

function serializeInventoryItem(item: InventoryItemRecord) {
  return {
    ...item,
    supplierUpdatedAt: item.supplierUpdatedAt?.toISOString() ?? null,
    updatedAt: item.updatedAt.toISOString(),
    reviewedAt: item.reviewedAt?.toISOString() ?? null,
  };
}

function deriveStatus(
  shopifyStock: number,
  supplierStatus: "available" | "low" | "unavailable" | "unknown",
  supplierStock: number | null,
) {
  if (supplierStatus === "unknown") return "pending" as const;
  if (supplierStatus === "unavailable") {
    return shopifyStock > 0 ? ("mismatch" as const) : ("unavailable" as const);
  }
  if ((supplierStock ?? 0) <= 5 || shopifyStock <= 2) return "low" as const;
  return "ready" as const;
}

router.get("/dashboard", async (_req, res): Promise<void> => {
  const [summaries, suppliers] = await Promise.all([
    db
      .select({
        totalSkus: sql<number>`count(*)::int`,
        readyToSell: sql<number>`count(*) filter (where ${inventoryItemsTable.status} = 'ready')::int`,
        lowStock: sql<number>`count(*) filter (where ${inventoryItemsTable.status} = 'low')::int`,
        unavailable: sql<number>`count(*) filter (where ${inventoryItemsTable.status} = 'unavailable')::int`,
        mismatches: sql<number>`count(*) filter (where ${inventoryItemsTable.status} = 'mismatch')::int`,
        pendingReview: sql<number>`count(*) filter (where ${inventoryItemsTable.status} = 'pending')::int`,
      })
      .from(inventoryItemsTable),
    db.select().from(suppliersTable).orderBy(desc(suppliersTable.lastUpdate)),
  ]);

  const summary = summaries[0] ?? {
    totalSkus: 0,
    readyToSell: 0,
    lowStock: 0,
    unavailable: 0,
    mismatches: 0,
    pendingReview: 0,
  };

  res.json(
    GetDashboardResponse.parse({
      ...summary,
      lastSupplierUpdate: suppliers[0]?.lastUpdate?.toISOString() ?? null,
      shopifyConnected: false,
      shopifyStoreName: null,
    }),
  );
});

router.get("/inventory", async (req, res): Promise<void> => {
  const parsed = ListInventoryQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const filters = [];
  if (parsed.data.search) {
    const term = `%${parsed.data.search}%`;
    filters.push(
      or(
        ilike(inventoryItemsTable.sku, term),
        ilike(inventoryItemsTable.productName, term),
        ilike(inventoryItemsTable.variant, term),
      ),
    );
  }
  if (parsed.data.status && parsed.data.status !== "all") {
    filters.push(eq(inventoryItemsTable.status, parsed.data.status));
  }
  if (parsed.data.supplier) {
    filters.push(eq(inventoryItemsTable.supplier, parsed.data.supplier));
  }

  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.pageSize ?? 100;
  const where = filters.length ? and(...filters) : undefined;
  const totals = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(inventoryItemsTable)
    .where(where);
  const total = totals[0]?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const resolvedPage = Math.min(page, totalPages);
  const items = await db
    .select()
    .from(inventoryItemsTable)
    .where(where)
    .orderBy(desc(inventoryItemsTable.updatedAt), asc(inventoryItemsTable.sku))
    .limit(pageSize)
    .offset((resolvedPage - 1) * pageSize);

  res.json(
    ListInventoryResponse.parse({
      items: items.map(serializeInventoryItem),
      total,
      page: resolvedPage,
      pageSize,
      totalPages,
    }),
  );
});

router.get("/inventory/:sku", async (req, res): Promise<void> => {
  const parsed = GetInventoryItemParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [item] = await db
    .select()
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.sku, parsed.data.sku));

  if (!item) {
    res.status(404).json({ error: "Inventory item not found" });
    return;
  }

  res.json(GetInventoryItemResponse.parse(serializeInventoryItem(item)));
});

router.patch("/inventory/:sku/review", async (req, res): Promise<void> => {
  const params = ReviewInventoryItemParams.safeParse(req.params);
  const body = ReviewInventoryItemBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res
      .status(400)
      .json({ error: params.error?.message ?? body.error?.message });
    return;
  }

  const reviewedAt = body.data.reviewed ? new Date() : null;
  const [item] = await db
    .update(inventoryItemsTable)
    .set({ reviewedAt })
    .where(eq(inventoryItemsTable.sku, params.data.sku))
    .returning();

  if (!item) {
    res.status(404).json({ error: "Inventory item not found" });
    return;
  }

  await db.insert(inventoryActivityTable).values({
    type: "review",
    title: body.data.reviewed ? "Item reviewed" : "Review reopened",
    description: `${item.sku} · ${item.productName}`,
  });

  res.json(ReviewInventoryItemResponse.parse(serializeInventoryItem(item)));
});

router.get("/suppliers", async (_req, res): Promise<void> => {
  const response = await db
    .select({
      name: suppliersTable.name,
      skuCount: sql<number>`count(${inventoryItemsTable.sku})::int`,
      availableCount: sql<number>`count(${inventoryItemsTable.sku}) filter (where ${inventoryItemsTable.supplierStatus} in ('available', 'low'))::int`,
      lastUpdate: suppliersTable.lastUpdate,
    })
    .from(suppliersTable)
    .leftJoin(
      inventoryItemsTable,
      eq(inventoryItemsTable.supplier, suppliersTable.name),
    )
    .groupBy(suppliersTable.name, suppliersTable.lastUpdate)
    .orderBy(desc(suppliersTable.lastUpdate));

  res.json(
    ListSuppliersResponse.parse(
      response.map((supplier) => ({
        ...supplier,
        lastUpdate: supplier.lastUpdate?.toISOString() ?? null,
      })),
    ),
  );
});

router.post(
  "/supplier-updates",
  requireSupplierMutationAccess,
  async (req, res): Promise<void> => {
  const parsed = ImportSupplierUpdateBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid supplier import");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const now = new Date();
  let matched = 0;
  let unmatched = 0;
  let updated = 0;
  const unmatchedSkus: string[] = [];

  await db.transaction(async (tx) => {
    for (const row of parsed.data.rows) {
      const [existing] = await tx
        .select()
        .from(inventoryItemsTable)
        .where(eq(inventoryItemsTable.sku, row.sku));

      const supplierStatus = !row.available
        ? ("unavailable" as const)
        : row.quantity <= 5
          ? ("low" as const)
          : ("available" as const);

      if (existing) {
        matched += 1;
        await tx
          .update(inventoryItemsTable)
          .set({
            supplier: parsed.data.supplier,
            supplierStock: row.quantity,
            supplierStatus,
            supplierPrice: row.supplierPrice ?? null,
            supplierEta: row.eta ?? null,
            supplierNotes: row.notes ?? null,
            supplierUpdatedAt: now,
            importedFields: row.raw ?? {},
            status: deriveStatus(
              existing.shopifyStock,
              supplierStatus,
              row.quantity,
            ),
          })
          .where(eq(inventoryItemsTable.sku, row.sku));
      } else {
        unmatched += 1;
        unmatchedSkus.push(row.sku);
        await tx.insert(inventoryItemsTable).values({
          sku: row.sku,
          productName: row.productName ?? `Unmatched supplier item ${row.sku}`,
          variant: row.variant ?? "Pending match",
          category: "Supplier import",
          shopifyStock: 0,
          supplierStock: row.quantity,
          supplier: parsed.data.supplier,
          supplierPrice: row.supplierPrice ?? null,
          supplierEta: row.eta ?? null,
          supplierNotes: row.notes ?? null,
          supplierUpdatedAt: now,
          importedFields: row.raw ?? {},
          supplierStatus,
          status: "pending",
          price: 0,
          image: "",
        });
      }
      updated += 1;
    }

    await tx
      .insert(suppliersTable)
      .values({
        name: parsed.data.supplier,
        lastFileName: parsed.data.fileName,
        lastUpdate: now,
      })
      .onConflictDoUpdate({
        target: suppliersTable.name,
        set: {
          lastFileName: parsed.data.fileName,
          lastUpdate: now,
        },
      });

    await tx.insert(inventoryActivityTable).values({
      type: "supplier_update",
      title: `${parsed.data.supplier} update imported`,
      description: `${updated} rows kept · ${matched} matched · ${unmatched} pending match`,
    });
  });

  res.status(201).json(
    ImportSupplierUpdateResponse.parse({
      supplier: parsed.data.supplier,
      fileName: parsed.data.fileName,
      totalRows: parsed.data.sourceRowCount,
      matched,
      unmatched,
      updated,
      skipped: parsed.data.skippedRows,
      unmatchedSkus,
      lastUpdated: now.toISOString(),
    }),
  );
  },
);

router.post(
  "/supplier-updates/hobbytyme/refresh",
  requireSupplierMutationAccess,
  async (req, res): Promise<void> => {
    try {
      const result = await refreshHobbyTymeInventory();
      res.status(201).json(ImportSupplierUpdateResponse.parse(result));
    } catch (error) {
      req.log.error({ err: error }, "HobbyTyme refresh failed");
      res.status(502).json({
        error:
          error instanceof Error
            ? error.message
            : "HobbyTyme inventory refresh failed",
      });
    }
  },
);

router.get("/activity", async (_req, res): Promise<void> => {
  const activity = await db
    .select()
    .from(inventoryActivityTable)
    .orderBy(desc(inventoryActivityTable.createdAt))
    .limit(12);

  res.json(
    ListActivityResponse.parse(
      activity.map((item) => ({
        ...item,
        id: String(item.id),
        createdAt: item.createdAt.toISOString(),
      })),
    ),
  );
});

export default router;
