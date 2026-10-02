import {
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const inventoryItemsTable = pgTable("inventory_items", {
  sku: text("sku").primaryKey(),
  productName: text("product_name").notNull(),
  variant: text("variant").notNull().default("Default"),
  category: text("category").notNull().default("Uncategorized"),
  shopifyStock: integer("shopify_stock").notNull().default(0),
  supplierStock: integer("supplier_stock"),
  supplier: text("supplier"),
  supplierPrice: doublePrecision("supplier_price"),
  supplierEta: text("supplier_eta"),
  supplierNotes: text("supplier_notes"),
  supplierUpdatedAt: timestamp("supplier_updated_at", { withTimezone: true }),
  importedFields: jsonb("imported_fields")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  supplierStatus: text("supplier_status").notNull().default("unknown"),
  status: text("status").notNull().default("pending"),
  price: doublePrecision("price").notNull().default(0),
  image: text("image").notNull().default(""),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const suppliersTable = pgTable("suppliers", {
  name: text("name").primaryKey(),
  lastFileName: text("last_file_name"),
  lastUpdate: timestamp("last_update", { withTimezone: true }),
});

export const inventoryActivityTable = pgTable("inventory_activity", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertInventoryItemSchema = createInsertSchema(
  inventoryItemsTable,
).omit({ updatedAt: true });
export const insertSupplierSchema = createInsertSchema(suppliersTable);
export const insertInventoryActivitySchema = createInsertSchema(
  inventoryActivityTable,
).omit({ id: true, createdAt: true });

export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InventoryItemRecord = typeof inventoryItemsTable.$inferSelect;
