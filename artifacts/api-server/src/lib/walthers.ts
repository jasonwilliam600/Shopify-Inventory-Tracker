import { sql } from "drizzle-orm";
import { db, supplierInventoryTable, suppliersTable, inventoryActivityTable, type InsertSupplierInventory } from "@workspace/db";
import type { WalthersRefreshStatus } from "@workspace/api-zod";
import { createWalthersSession } from "./walthers-session";
import { normalizeWalthersItem, type WalthersItem } from "./walthers-records";
import { readWalthersCatalog, type CatalogPage } from "./walthers-catalog";
import { logger } from "./logger";

const SUPPLIER = "Walthers";
const SOURCE = "Walthers authenticated dealer catalog";
const FIELDS = [
  "internalid", "itemid", "storedisplayname2", "storedescription",
  "quantityavailable", "onlinecustomerprice", "pricelevel1", "custitem_walthers_item_brand",
].join(",");
let job: WalthersRefreshStatus = {
  state: "idle", startedAt: null, fetchedRows: 0, totalRows: 0, result: null, error: null,
};

export function getWalthersRefreshStatus(): WalthersRefreshStatus {
  return { ...job };
}

async function performRefresh() {
  const session = await createWalthersSession();
  const records = await readWalthersCatalog(async (filters, offset, includeFacets) => {
    const params = new URLSearchParams({
      n: String(session.siteId), limit: "100", offset: String(offset),
      sort: "itemid:asc", ...filters, fields: FIELDS, ...(includeFacets ? { include: "facets" } : {}),
    });
    const response = await session.get(`/api/items?${params}`);
    if (!response.ok || !response.headers.get("content-type")?.includes("json")) {
      throw new Error(`Walthers dealer catalog returned HTTP ${response.status}; previous inventory preserved`);
    }
    return await response.json() as CatalogPage;
  }, (fetchedRows, totalRows) => {
    job.fetchedRows = fetchedRows;
    job.totalRows = totalRows;
  });
  const profileResponse = await session.get(`/scs/services/CheckoutEnvironment.Service.ss?lang=en_US&cur=USD&X-SC-Touchpoint=checkout&_=${Date.now()}`);
  if (!profileResponse.ok) throw new Error("Walthers session could not be verified; previous inventory preserved");
  const verification = await profileResponse.json() as { ENVIRONMENT?: { PROFILE?: { isLoggedIn?: string; isGuest?: string } } };
  const profile = verification.ENVIRONMENT?.PROFILE;
  if (profile?.isLoggedIn !== "T" || profile?.isGuest === "T") {
    throw new Error("Walthers dealer session expired during download; previous inventory preserved");
  }

  const now = new Date();
  const offers = new Map<string, InsertSupplierInventory>();
  let skipped = 0;
  for (const item of records) {
    const normalized = normalizeWalthersItem(item);
    const previous = offers.get(normalized.sku);
    if (previous) {
      skipped++;
      // Duplicate supplier SKUs must never be added together or arbitrarily
      // overwrite a conflicting quantity/price.
      const oldRecords = (previous.importedFields?.records ?? []) as WalthersItem[];
      oldRecords.push(item);
      previous.importedFields = { ...previous.importedFields, records: oldRecords };
      if (previous.supplierStock !== normalized.supplierStock ||
          previous.supplierPrice !== normalized.supplierPrice ||
          previous.importedFields.manufacturerName !== normalized.manufacturerName) {
        previous.supplierStock = null;
        previous.supplierPrice = null;
        previous.supplierStatus = "unknown";
        previous.supplierNotes = "Duplicate Walthers records disagree; quantity and price require review.";
      }
      continue;
    }
    offers.set(normalized.sku, {
      sku: normalized.sku, supplier: SUPPLIER, productName: normalized.productName,
      variant: "Default", category: "Hobby",
      supplierStock: normalized.supplierStock, supplierPrice: normalized.supplierPrice,
      supplierStatus: normalized.supplierStatus, price: normalized.price,
      supplierUpdatedAt: now, updatedAt: now,
      supplierNotes: normalized.quantityNote ?? "Walthers product units; store SKU and pack-to-piece conversions are not verified.",
      importedFields: { ...item, manufacturerName: normalized.manufacturerName, records: [item] },
    });
  }
  if (!offers.size) throw new Error("Walthers catalog is empty; previous inventory preserved");
  await db.transaction(async (tx) => {
    // Expire only Walthers offers absent from this complete catalog.
    await tx.update(supplierInventoryTable).set({
      supplierStock: 0, supplierStatus: "unavailable", supplierUpdatedAt: now, updatedAt: now,
    }).where(sql`${supplierInventoryTable.supplier} = ${SUPPLIER}`);
    const values = [...offers.values()];
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
      type: "supplier_update", title: "Walthers inventory refreshed",
      description: `${offers.size} independent supplier SKUs imported; Heartland and HobbyTyme preserved`,
    });
  });
  return {
    supplier: SUPPLIER, fileName: SOURCE, totalRows: records.length,
    matched: 0, unmatched: offers.size, updated: offers.size, skipped,
    unmatchedSkus: [], lastUpdated: now.toISOString(),
    unknownQuantities: [...offers.values()].filter((offer) => offer.supplierStock == null).length,
  };
}

/** Return immediately; the browser polls while the long import runs. */
export function startWalthersRefresh(): WalthersRefreshStatus {
  if (job.state === "running") return getWalthersRefreshStatus();
  job = { state: "running", startedAt: new Date(), fetchedRows: 0, totalRows: 0, result: null, error: null };
  void performRefresh().then((result) => {
    job = {
      ...job, state: "complete", result,
      warning: result.unknownQuantities ? `${result.unknownQuantities} SKUs have uncertain quantities. Original values are retained for review and excluded from quantity totals.` : null,
    };
    logger.info({ updated: result.updated, duplicates: result.skipped }, "Walthers dealer inventory refresh completed");
  }).catch((error) => {
    job = { ...job, state: "failed", error: error instanceof Error ? error.message : "Walthers refresh failed; previous inventory preserved" };
    logger.error({ err: error }, "Walthers inventory refresh failed; previous inventory preserved");
  });
  return getWalthersRefreshStatus();
}

let schedulerStarted = false;

export function startWalthersRefreshScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // Wait one hour before the first scheduled run. Manual and scheduled
  // refreshes share the running-job guard in startWalthersRefresh.
  setInterval(() => {
    if (job.state === "running") {
      logger.info("Walthers scheduled refresh skipped; an import is already running");
      return;
    }
    startWalthersRefresh();
  }, 60 * 60 * 1000).unref();
  logger.info({ intervalMinutes: 60 }, "Walthers automatic inventory refresh scheduled");
}