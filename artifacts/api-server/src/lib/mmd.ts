import { sql } from "drizzle-orm";
import { db, supplierInventoryTable, suppliersTable, inventoryActivityTable, type InsertSupplierInventory } from "@workspace/db";
import type { MmdRefreshStatus } from "@workspace/api-zod";
import { createMmdSession } from "./mmd-session";
import { parseMmdStockCsv, parseMmdCatalogPage, parseMmdBrandDirectory, isMmdAuthenticated, type MmdDealerProduct } from "./mmd-records";
import { logger } from "./logger";

const SUPPLIER = "MMD/Squadron";
const SOURCE = "MMD stock export + authenticated dealer catalog";
let job: MmdRefreshStatus = {
  state: "idle", startedAt: null, fetchedRows: 0, totalRows: 0, result: null, error: null,
};

export function getMmdRefreshStatus(): MmdRefreshStatus {
  return { ...job };
}

async function performRefresh() {
  const session = await createMmdSession();
  const feed = await session.get("/content/mmdinventory.csv");
  if (!feed.ok) throw new Error(`MMD stock export returned HTTP ${feed.status}; previous inventory preserved`);
  const feedLastModified = feed.headers.get("last-modified");
  const records = parseMmdStockCsv(await feed.text());
  job.totalRows = records.length;

  // The unfiltered storefront silently stops at 10,000 products. Enumerate
  // native brand partitions instead; their bulk-order tables also expose
  // verified live quantities for products absent from the CSV.
  const directory = await session.get("/sitemap/brands/");
  if (!directory.ok) throw new Error(`MMD brand directory returned HTTP ${directory.status}`);
  const brands = parseMmdBrandDirectory(await directory.text());
  const prices = new Map<string, string | null>();
  const products = new Map<string, MmdDealerProduct>();
  let cursor = 0;
  let failure: unknown = null;
  async function worker() {
    try {
      while (!failure && cursor < brands.length) {
        const brand = new URL(brands[cursor++]);
        brand.search = new URLSearchParams({ limit: "100", sort: "alphaasc" }).toString();
        let next: string | null = brand.href;
        const visited = new Set<string>();
        let partitionRows = 0;
        while (next && !failure) {
          const path = new URL(next, "https://mmdmodels.com").href;
          if (visited.has(path) || visited.size >= 100) throw new Error("MMD brand pagination reached the catalog limit; previous inventory preserved");
          visited.add(path);
          const response = await session.get(path);
          if (!response.ok) throw new Error(`MMD dealer catalog returned HTTP ${response.status}; previous inventory preserved`);
          const page = parseMmdCatalogPage(await response.text(), brand.pathname);
          partitionRows += page.prices.size;
          if (partitionRows >= 10_000) throw new Error("MMD brand partition hit the 10,000-product limit; previous inventory preserved");
          for (const [sku, price] of page.prices) {
            if (prices.has(sku) && prices.get(sku) !== price) throw new Error("MMD catalog has conflicting dealer prices; please retry");
            prices.set(sku, price);
          }
          for (const [sku, product] of page.products) products.set(sku, product);
          job.fetchedRows = prices.size;
          next = page.next;
        }
      }
    } catch (error) {
      failure = error;
      throw error;
    }
  }
  // Drain both workers on failure before releasing the shared job guard.
  await Promise.allSettled([worker(), worker()]);
  if (failure) throw failure;
  if (!prices.size || !records.some(record => prices.get(record.sku) != null)) {
    throw new Error("MMD dealer pricing could not be matched to the stock export; previous inventory preserved");
  }
  const verification = await session.get("/products/?limit=1");
  if (!verification.ok || !isMmdAuthenticated(await verification.text())) {
    throw new Error("MMD dealer session expired during download; previous inventory preserved");
  }

  const now = new Date();
  const exportSkus = new Set(records.map(record => record.sku));
  const combined = records.map(record => {
    const live = products.get(record.sku);
    return {
      ...record,
      productName: live?.productName ?? record.productName,
      manufacturerName: live?.manufacturerName ?? record.manufacturerName,
      stock: live?.stock ?? record.stock,
      msrp: live?.msrp ?? record.msrp,
      quantitySource: live?.stock != null ? "Authenticated MMD dealer table" : "MMD stock export",
    };
  });
  for (const live of products.values()) {
    if (exportSkus.has(live.sku)) continue;
    combined.push({
      sku: live.sku, productName: live.productName, manufacturerName: live.manufacturerName,
      stock: live.stock, msrp: live.msrp, raw: {},
      quantitySource: "Authenticated MMD dealer table",
    });
  }
  const missingPrices = combined.filter(record => prices.get(record.sku) == null).length;
  const unknownQuantities = combined.filter(record => record.stock == null).length;
  const missingMsrp = combined.filter(record => record.msrp == null).length;
  const warnings: string[] = [];
  if (missingPrices) warnings.push(`${missingPrices.toLocaleString()} SKUs have no verified dealer price. Cost is unknown; MSRP was not substituted.`);
  if (unknownQuantities) warnings.push(`${unknownQuantities.toLocaleString()} SKUs have uncertain quantities, retained for review and excluded from quantity totals.`);
  if (missingMsrp) warnings.push(`${missingMsrp.toLocaleString()} SKUs have no MSRP in the export; the original blank values are retained.`);
  const values: InsertSupplierInventory[] = combined.map((record): InsertSupplierInventory => {
    const notes = ["MMD product units; store SKU and pack-to-piece conversions are not verified."];
    if (record.stock == null) notes.push("Original quantity requires review.");
    if (prices.get(record.sku) == null) notes.push("No verified dealer price; MSRP is not wholesale cost.");
    if (record.msrp == null) notes.push("MSRP was not supplied; the legacy price field's zero is not a verified retail price.");
    return {
      sku: record.sku, supplier: SUPPLIER, productName: record.productName,
      variant: "Default", category: "Hobby", supplierStock: record.stock,
      supplierPrice: prices.get(record.sku) == null ? null : Number(prices.get(record.sku)),
      price: record.msrp == null ? 0 : Number(record.msrp),
      supplierStatus: record.stock == null ? "unknown" : record.stock === 0 ? "unavailable" : record.stock <= 5 ? "low" : "available",
      supplierNotes: notes.join(" "), supplierUpdatedAt: now, updatedAt: now,
      importedFields: {
        ...record.raw, manufacturerName: record.manufacturerName, feedLastModified,
        quantitySource: record.quantitySource,
        ...(products.has(record.sku) ? { dealerCatalogRecord: products.get(record.sku) } : {}),
        dealerPrice: prices.get(record.sku) ?? null,
        dealerPriceSource: prices.get(record.sku) != null ? "Authenticated MMD product catalog" : null,
      },
    };
  });

  await db.transaction(async tx => {
    // Only this wholesaler is expired/upserted; never alter store inventory.
    await tx.update(supplierInventoryTable).set({
      supplierStock: 0, supplierStatus: "unavailable", supplierUpdatedAt: now, updatedAt: now,
    }).where(sql`${supplierInventoryTable.supplier} = ${SUPPLIER}`);
    for (let index = 0; index < values.length; index += 500) {
      await tx.insert(supplierInventoryTable).values(values.slice(index, index + 500)).onConflictDoUpdate({
        target: [supplierInventoryTable.supplier, supplierInventoryTable.sku],
        set: {
          productName: sql`excluded.product_name`, supplierStock: sql`excluded.supplier_stock`,
          supplierPrice: sql`excluded.supplier_price`, supplierStatus: sql`excluded.supplier_status`,
          supplierNotes: sql`excluded.supplier_notes`, price: sql`excluded.price`,
          importedFields: sql`excluded.imported_fields`, supplierUpdatedAt: now, updatedAt: now,
        },
      });
    }
    await tx.insert(suppliersTable).values({ name: SUPPLIER, lastFileName: SOURCE, lastUpdate: now })
      .onConflictDoUpdate({ target: suppliersTable.name, set: { lastFileName: SOURCE, lastUpdate: now } });
    await tx.insert(inventoryActivityTable).values({
      type: "supplier_update", title: "MMD/Squadron inventory refreshed",
      description: `${values.length} independent supplier SKUs imported; existing suppliers preserved`,
    });
  });
  return {
    warning: warnings.join(" ") || null,
    result: {
      supplier: SUPPLIER, fileName: SOURCE, totalRows: combined.length,
      matched: 0, unmatched: values.length, updated: values.length, skipped: 0,
      unmatchedSkus: [], lastUpdated: now.toISOString(),
    },
  };
}

/** Manual and scheduled requests share a single background job. */
export function startMmdRefresh(): MmdRefreshStatus {
  if (job.state === "running") return getMmdRefreshStatus();
  job = { state: "running", startedAt: new Date(), fetchedRows: 0, totalRows: 0, result: null, error: null };
  void performRefresh().then(({ result, warning }) => {
    job = { ...job, state: "complete", result, warning };
    logger.info({ updated: result.updated }, "MMD/Squadron inventory refresh completed");
  }).catch(error => {
    job = { ...job, state: "failed", error: error instanceof Error ? error.message : "MMD refresh failed; previous inventory preserved" };
    // Upstream responses and request bodies may contain credentials or account data.
    logger.error({ message: job.error }, "MMD/Squadron inventory refresh failed; previous inventory preserved");
  });
  return getMmdRefreshStatus();
}

let schedulerStarted = false;

export function startMmdRefreshScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // The first scheduled refresh is one hour after startup. The shared job
  // guard prevents manual and scheduled imports from overlapping.
  setInterval(() => {
    if (job.state === "running") {
      logger.info("MMD/Squadron scheduled refresh skipped; an import is already running");
      return;
    }
    startMmdRefresh();
  }, 60 * 60 * 1000).unref();
  logger.info({ intervalMinutes: 60 }, "MMD/Squadron automatic inventory refresh scheduled");
}