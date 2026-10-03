import { doublePrecision, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Supplier identifiers remain verbatim; an offer is unique within its supplier.
export const supplierInventoryTable = pgTable("supplier_inventory", {
  sku: text("sku").notNull(),
  supplier: text("supplier").notNull(),
  productName: text("product_name").notNull(),
  variant: text("variant").notNull().default("Default"),
  category: text("category").notNull().default("Uncategorized"),
  shopifyStock: integer("shopify_stock").notNull().default(0),
  supplierStock: integer("supplier_stock"),
  supplierPrice: doublePrecision("supplier_price"),
  supplierEta: text("supplier_eta"),
  supplierNotes: text("supplier_notes"),
  supplierUpdatedAt: timestamp("supplier_updated_at", { withTimezone: true }),
  importedFields: jsonb("imported_fields").$type<Record<string, unknown>>().notNull().default({}),
  supplierStatus: text("supplier_status").notNull().default("unknown"),
  status: text("status").notNull().default("pending"),
  price: doublePrecision("price").notNull().default(0),
  image: text("image").notNull().default(""),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.supplier, table.sku] })]);

export const insertSupplierInventorySchema = createInsertSchema(supplierInventoryTable);
export type InsertSupplierInventory = z.infer<typeof insertSupplierInventorySchema>;