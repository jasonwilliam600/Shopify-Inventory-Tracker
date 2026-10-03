import { sql } from "drizzle-orm";
import { db, supplierInventoryTable, suppliersTable, inventoryActivityTable, type InsertSupplierInventory } from "@workspace/db";
import { parseSupplierCsv } from "./supplier-csv";
import { logger } from "./logger";

const SUPPLIER = "Heartland Hobby Wholesale";
const FILE = "HHW_In_Stock.csv";
const URL = `https://400.vsa1.com:8088/hhw/download/${FILE}`;
let inFlight: Promise<Awaited<ReturnType<typeof performRefresh>>> | null = null;

async function performRefresh() {
  const username = process.env.HEARTLAND_USERNAME;
  const password = process.env.HEARTLAND_PASSWORD;
  if (!username || !password) throw new Error("Heartland dealer credentials are not configured");
  const response = await fetch(URL, {
    headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` },
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Heartland returned HTTP ${response.status}`);
  const rows = parseSupplierCsv(new TextDecoder("windows-1252").decode(await response.arrayBuffer()));
  const headers = rows.shift() ?? [];
  const required = ["ZCMITEM", "ZCMDESC", "ZCMMSRP", "ZCMSTDC", "ZCMQOH"];
  if (required.some((h) => !headers.includes(h))) throw new Error("Heartland inventory export has unexpected columns");
  const at = (row: string[], header: string) => row[headers.indexOf(header)] ?? "";
  const now = new Date();
  const offers = new Map<string, InsertSupplierInventory>();
  let skipped = 0;
  for (const row of rows) {
    const sku = at(row, "ZCMITEM");
    const stock = Number(at(row, "ZCMQOH"));
    const price = Number(at(row, "ZCMMSRP"));
    const cost = Number(at(row, "ZCMSTDC"));
    if (!sku || !at(row, "ZCMQOH") || !Number.isSafeInteger(stock) || stock < 0 || !Number.isFinite(price) || price < 0 || !Number.isFinite(cost) || cost < 0) {
      throw new Error("Heartland export contains an invalid SKU, quantity, or price; no changes imported");
    }
    const sale = Number(at(row, "ZCMSALEP"));
    if (offers.has(sku)) skipped++;
    offers.set(sku, {
      sku, supplier: SUPPLIER, productName: at(row, "ZCMDESC") || sku,
      variant: "Default", category: "Hobby", supplierStock: stock,
      supplierPrice: Number.isFinite(sale) && sale > 0 ? sale : cost,
      price, supplierStatus: stock === 0 ? "unavailable" : stock <= 5 ? "low" : "available",
      supplierUpdatedAt: now, updatedAt: now,
      importedFields: Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ""])),
    });
  }
  if (!offers.size) throw new Error("Heartland export is empty; previous inventory preserved");
  await db.transaction(async (tx) => {
    // This is an in-stock snapshot: items missing from a newer file must not retain stale stock.
    await tx.update(supplierInventoryTable).set({
      supplierStock: 0, supplierStatus: "unavailable", supplierUpdatedAt: now, updatedAt: now,
    }).where(sql`${supplierInventoryTable.supplier} = ${SUPPLIER}`);
    const values = [...offers.values()];
    for (let i = 0; i < values.length; i += 500) {
      await tx.insert(supplierInventoryTable).values(values.slice(i, i + 500)).onConflictDoUpdate({
        target: [supplierInventoryTable.supplier, supplierInventoryTable.sku],
        set: {
          productName: sql`excluded.product_name`, supplierStock: sql`excluded.supplier_stock`,
          supplierPrice: sql`excluded.supplier_price`, supplierStatus: sql`excluded.supplier_status`,
          supplierUpdatedAt: now, updatedAt: now, price: sql`excluded.price`,
          importedFields: sql`excluded.imported_fields`,
        },
      });
    }
    await tx.insert(suppliersTable).values({ name: SUPPLIER, lastFileName: FILE, lastUpdate: now })
      .onConflictDoUpdate({ target: suppliersTable.name, set: { lastFileName: FILE, lastUpdate: now } });
    await tx.insert(inventoryActivityTable).values({
      type: "supplier_update", title: "Heartland inventory refreshed",
      description: `${offers.size} supplier SKUs imported independently; other wholesalers preserved`,
    });
  });
  return {
    supplier: SUPPLIER, fileName: FILE, totalRows: rows.length, matched: 0,
    unmatched: offers.size, updated: offers.size, skipped, unmatchedSkus: [],
    lastUpdated: now.toISOString(),
  };
}

export function refreshHeartlandInventory() {
  if (!inFlight) inFlight = performRefresh().finally(() => { inFlight = null; });
  return inFlight;
}

let schedulerStarted = false;

export function startHeartlandRefreshScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const intervalMs = 30 * 60 * 1000;
  const run = () => {
    void refreshHeartlandInventory()
      .then((result) => {
        logger.info(
          { fileName: result.fileName, updated: result.updated },
          "Heartland automatic inventory refresh completed",
        );
      })
      .catch((err) => {
        logger.error({ err }, "Heartland automatic inventory refresh failed; previous inventory preserved");
      });
  };

  // Refresh soon after startup, then every 30 minutes. Manual and scheduled
  // requests share inFlight, so they cannot import overlapping snapshots.
  setTimeout(run, 15_000).unref();
  setInterval(run, intervalMs).unref();
  logger.info({ intervalMinutes: 30 }, "Heartland automatic inventory refresh scheduled");
}