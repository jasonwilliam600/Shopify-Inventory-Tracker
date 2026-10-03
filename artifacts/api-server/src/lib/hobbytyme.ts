import { eq, sql } from "drizzle-orm";
import {
  db,
  inventoryActivityTable,
  inventoryItemsTable,
  suppliersTable,
  supplierInventoryTable,
  type InsertInventoryItem,
} from "@workspace/db";
import { logger } from "./logger";

const INDEX_URL = "https://www.hobbytyme.com/inventoryexport/";
const SUPPLIER_NAME = "HobbyTyme";
const BATCH_SIZE = 500;
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

let refreshInFlight: Promise<HobbyTymeRefreshResult> | null = null;

export interface HobbyTymeRefreshResult {
  supplier: string;
  fileName: string;
  totalRows: number;
  matched: number;
  unmatched: number;
  updated: number;
  skipped: number;
  unmatchedSkus: string[];
  lastUpdated: string;
}

function credentials() {
  const username = process.env.HOBBYTYME_USERNAME;
  const password = process.env.HOBBYTYME_PASSWORD;
  if (!username || !password) {
    throw new Error("HobbyTyme credentials are not configured");
  }
  return Buffer.from(`${username}:${password}`).toString("base64");
}

async function authenticatedFetch(url: string) {
  const response = await fetch(url, {
    headers: { Authorization: `Basic ${credentials()}` },
  });
  if (!response.ok) {
    throw new Error(`HobbyTyme returned HTTP ${response.status}`);
  }
  return response;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function numberValue(value: string | undefined) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

async function performRefresh(): Promise<HobbyTymeRefreshResult> {
  const indexResponse = await authenticatedFetch(INDEX_URL);
  const indexHtml = await indexResponse.text();
  const latestFile = indexHtml.match(
    /href=["'](InventoryExport_[^"']+\.csv)["']/i,
  )?.[1];
  if (!latestFile) {
    throw new Error("No HobbyTyme CSV export was found");
  }

  const [supplierRecord] = await db
    .select()
    .from(suppliersTable)
    .where(eq(suppliersTable.name, SUPPLIER_NAME));

  if (supplierRecord?.lastFileName === latestFile && supplierRecord.lastUpdate) {
    return {
      supplier: SUPPLIER_NAME,
      fileName: latestFile,
      totalRows: 0,
      matched: 0,
      unmatched: 0,
      updated: 0,
      skipped: 0,
      unmatchedSkus: [],
      lastUpdated: supplierRecord.lastUpdate.toISOString(),
    };
  }

  const csvResponse = await authenticatedFetch(`${INDEX_URL}${latestFile}`);
  const csvRows = parseCsv(await csvResponse.text());
  const headers = csvRows[0] ?? [];
  const headerIndex = new Map(
    headers.map((header, index) => [header.trim().toLowerCase(), index]),
  );
  const at = (row: string[], name: string) =>
    row[headerIndex.get(name.toLowerCase()) ?? -1] ?? "";

  const sourceRows = csvRows.slice(1);
  const valuesBySku = new Map<string, InsertInventoryItem>();
  let skipped = 0;
  for (const row of sourceRows) {
    const sku = at(row, "Part Number").trim();
    if (!sku) {
      skipped += 1;
      continue;
    }
    const stock = Math.max(0, Math.trunc(numberValue(at(row, "On Hand")) ?? 0));
    const listPrice = numberValue(at(row, "List Price")) ?? 0;
    const netPrice = numberValue(at(row, "Net Price"));
    const supplierStatus =
      stock === 0 ? "unavailable" : stock <= 5 ? "low" : "available";
    if (valuesBySku.has(sku)) skipped += 1;
    valuesBySku.set(sku, {
      sku,
      productName: at(row, "Description") || `HobbyTyme item ${sku}`,
      variant: at(row, "Vendor") || "Default",
      category: at(row, "Product Category") || "Hobby",
      supplierStock: stock,
      supplier: SUPPLIER_NAME,
      supplierPrice: netPrice,
      supplierUpdatedAt: new Date(),
      importedFields: Object.fromEntries(
        headers.map((header, index) => [header, row[index] ?? ""]),
      ),
      supplierStatus,
      status: "pending",
      price: listPrice,
      image: "",
    });
  }
  const values = Array.from(valuesBySku.values());

  const existingRows = await db
    .select({ sku: inventoryItemsTable.sku })
    .from(inventoryItemsTable);
  const existing = new Set(existingRows.map((item) => item.sku));
  const matched = values.filter((item) => existing.has(item.sku)).length;
  const unmatched = values.length - matched;
  const now = new Date();

  await db.transaction(async (tx) => {
    for (let offset = 0; offset < values.length; offset += BATCH_SIZE) {
      const batch = values.slice(offset, offset + BATCH_SIZE);
      await tx.insert(supplierInventoryTable).values(batch.map((value) => ({
        ...value, supplier: SUPPLIER_NAME,
      }))).onConflictDoUpdate({
        target: [supplierInventoryTable.supplier, supplierInventoryTable.sku],
        set: {
          productName: sql`excluded.product_name`, variant: sql`excluded.variant`,
          category: sql`excluded.category`, supplierStock: sql`excluded.supplier_stock`,
          supplierPrice: sql`excluded.supplier_price`, supplierUpdatedAt: now,
          importedFields: sql`excluded.imported_fields`, supplierStatus: sql`excluded.supplier_status`,
          price: sql`excluded.price`, updatedAt: now,
        },
      });
      await tx
        .insert(inventoryItemsTable)
        .values(batch)
        .onConflictDoUpdate({
          target: inventoryItemsTable.sku,
          set: {
            productName: sql`excluded.product_name`,
            variant: sql`excluded.variant`,
            category: sql`excluded.category`,
            supplierStock: sql`excluded.supplier_stock`,
            supplier: sql`excluded.supplier`,
            supplierPrice: sql`excluded.supplier_price`,
            supplierUpdatedAt: sql`excluded.supplier_updated_at`,
            importedFields: sql`excluded.imported_fields`,
            supplierStatus: sql`excluded.supplier_status`,
            price: sql`excluded.price`,
            updatedAt: now,
            status: sql`CASE
              WHEN ${inventoryItemsTable.shopifyStock} > 0 AND excluded.supplier_status = 'unavailable' THEN 'mismatch'
              WHEN ${inventoryItemsTable.shopifyStock} = 0 THEN 'pending'
              WHEN excluded.supplier_status = 'unavailable' THEN 'unavailable'
              WHEN excluded.supplier_stock <= 5 OR ${inventoryItemsTable.shopifyStock} <= 2 THEN 'low'
              ELSE 'ready'
            END`,
          },
          setWhere: sql`${inventoryItemsTable.supplier} = ${SUPPLIER_NAME} OR ${inventoryItemsTable.supplier} IS NULL`,
        });
    }

    await tx
      .insert(suppliersTable)
      .values({
        name: SUPPLIER_NAME,
        lastFileName: latestFile,
        lastUpdate: now,
      })
      .onConflictDoUpdate({
        target: suppliersTable.name,
        set: { lastFileName: latestFile, lastUpdate: now },
      });

    await tx.insert(inventoryActivityTable).values({
      type: "supplier_update",
      title: "HobbyTyme inventory refreshed",
      description: `${values.length} rows kept from ${latestFile}`,
    });
  });

  return {
    supplier: SUPPLIER_NAME,
    fileName: latestFile,
    totalRows: sourceRows.length,
    matched,
    unmatched,
    updated: values.length,
    skipped,
    unmatchedSkus: [],
    lastUpdated: now.toISOString(),
  };
}

export function refreshHobbyTymeInventory() {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export function startHobbyTymeRefreshScheduler() {
  if (process.env.HOBBYTYME_AUTO_REFRESH !== "true") return;

  const run = () => {
    void refreshHobbyTymeInventory()
      .then((result) => {
        logger.info(
          { fileName: result.fileName, updated: result.updated },
          "HobbyTyme inventory refresh completed",
        );
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, "HobbyTyme inventory refresh failed");
      });
  };

  setTimeout(run, 15_000);
  setInterval(run, REFRESH_INTERVAL_MS).unref();
}