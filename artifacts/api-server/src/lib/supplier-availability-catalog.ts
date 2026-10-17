import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import type { SupplierAvailabilityCatalog } from "@workspace/api-zod";
import type { CatalogVariant } from "./supplier-availability";
import { MAPPING_POLICY_COUNTS } from "./supplier-mapping-policy";

export interface AvailabilityCatalog {
  variants: CatalogVariant[];
  knownSkus: Set<string>;
  metadata: SupplierAvailabilityCatalog;
}
const blocker = "Historical export only: no live Shopify variant IDs, current catalog verification, or product/selling-unit approvals. Mapping schema is installed; live catalog import and approval activation require separate authorization. Publishing is disabled.";
const base = {
  verified: false, containsVariantIds: false, publishingEnabled: false,
  physicalStockExists: false, ...MAPPING_POLICY_COUNTS,
};

export function parseAvailabilityCatalog(csv: string, comparedAt: string, expectedCount: number): AvailabilityCatalog {
  if (!Number.isFinite(new Date(comparedAt).getTime())) throw new Error("CATALOG_SNAPSHOT_INVALID");
  const rows = parse(csv, { columns: true, bom: true, skip_empty_lines: true }) as Record<string, string>[];
  if (!rows.length || rows.length !== expectedCount
    || !["Store SKU", "Handle", "Title", "Option 1", "Option 2", "Option 3"].every(key => Object.hasOwn(rows[0], key))) {
    throw new Error("CATALOG_SNAPSHOT_INVALID");
  }
  const counts = new Map<string, number>();
  for (const row of rows) {
    const sku = row["Store SKU"].trim();
    if (sku) counts.set(sku, (counts.get(sku) ?? 0) + 1);
  }
  const variants = rows.map((row, index): CatalogVariant => {
    const sku = row["Store SKU"].trim();
    const options = [row["Option 1"], row["Option 2"], row["Option 3"]].filter(Boolean);
    return {
      // A local locator, explicitly NOT a Shopify ID.
      key: `historical:${createHash("sha256").update(JSON.stringify([comparedAt, index, row.Handle, options, sku])).digest("hex").slice(0, 24)}`,
      variantId: null, sku, title: row.Title, handle: row.Handle, options, vendor: row.Vendor ?? "",
      skuStatus: !sku ? "missing" : counts.get(sku)! > 1 ? "duplicate" : "unique",
    };
  });
  return {
    variants, knownSkus: new Set(counts.keys()),
    metadata: {
      ...base, source: "historical", observedAt: new Date(comparedAt),
      totalVariants: variants.length, duplicateSkuGroups: [...counts.values()].filter(count => count > 1).length,
      missingSkuVariants: variants.filter(variant => variant.skuStatus === "missing").length, blocker,
    },
  };
}

let cached: { at: number; data: AvailabilityCatalog } | undefined;
let pending: Promise<AvailabilityCatalog> | undefined;
async function readExistingSnapshot(): Promise<AvailabilityCatalog> {
  // Existing ignored report, never copied into application source or rewritten.
  // Support both workspace-root and artifact working directories.
  for (const root of [process.cwd(), path.resolve(process.cwd(), "../..")]) {
    const directory = path.join(root, "reports/store-catalog-comparison");
    try {
      const [csv, summaryText] = await Promise.all([
        readFile(path.join(directory, "store-variants.csv"), "utf8"),
        readFile(path.join(directory, "summary.json"), "utf8"),
      ]);
      const summary = JSON.parse(summaryText) as { comparedAt: string; variants: number };
      return parseAvailabilityCatalog(csv, summary.comparedAt, summary.variants);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error("CATALOG_SNAPSHOT_INVALID");
    }
  }
  return {
    variants: [], knownSkus: new Set(),
    metadata: {
      ...base, source: "unavailable", observedAt: null, totalVariants: 0,
      duplicateSkuGroups: 0, missingSkuVariants: 0,
      blocker: "Local historical catalog is unavailable. Supplier records are not a Shopify catalog. Approve the persistent catalog cache and a fresh read-only catalog import; no variants or verified matches can be inferred.",
    },
  };
}
export async function loadAvailabilityCatalog(): Promise<AvailabilityCatalog> {
  if (cached && Date.now() - cached.at < 60_000) return cached.data;
  if (!pending) pending = readExistingSnapshot().then(data => {
    cached = { at: Date.now(), data };
    return data;
  }).finally(() => { pending = undefined; });
  return pending;
}
