import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/** Add existing registered supplier records without modifying their source rows. */
export async function initializeSupplierInventory() {
  await db.transaction(async (tx) => {
    // Bound this compatibility backfill without changing session settings for
    // supplier refreshes, which legitimately need longer transactions.
    await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    await tx.execute(sql`
    INSERT INTO supplier_inventory (
      sku, supplier, product_name, variant, category, shopify_stock,
      supplier_stock, supplier_price, supplier_eta, supplier_notes,
      supplier_updated_at, imported_fields, supplier_status, status,
      price, image, reviewed_at, updated_at
    )
    SELECT i.sku, i.supplier, i.product_name, i.variant, i.category, i.shopify_stock,
      i.supplier_stock, i.supplier_price, i.supplier_eta, i.supplier_notes,
      i.supplier_updated_at, i.imported_fields, i.supplier_status, i.status,
      i.price, i.image, i.reviewed_at, i.updated_at
    FROM inventory_items i
    JOIN suppliers s ON s.name = i.supplier
    WHERE i.supplier_updated_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM supplier_inventory existing
        WHERE existing.supplier = i.supplier AND existing.sku = i.sku
      )
    ON CONFLICT (supplier, sku) DO NOTHING
    `);
  });
}