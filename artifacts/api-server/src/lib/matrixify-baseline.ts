/** Bounded, data-only CSV parser. An input baseline NEVER imports catalog rows. */
import { parse } from "csv-parse/sync";
import type { CatalogRecord } from "./mapping-approval";
import type { MatrixifyConfiguration } from "./matrixify-configuration";
import type { VerifiedSyncVariant } from "./synchronization-types";
import { WorkflowError } from "./reviewer-authorization";

export const MATRIXIFY_BASELINE_MAX_BYTES = 20_000_000;
export function shopifyNumericId(gid: string, kind: "Product" | "ProductVariant") {
  const match = gid.match(new RegExp(`^gid://shopify/${kind}/([1-9]\\d*)$`));
  if (!match || match[1].length > 25) throw new WorkflowError("INVALID_SHOPIFY_ID", 400);
  // Text, never IEEE754 or Excel numeric conversion.
  return match[1];
}
function quantity(value: string) {
  // An unavailable baseline is a per-variant exception, never an invented zero.
  // The shared planner rejects non-finite baselines before inventory/price ops.
  if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) return NaN;
  return Number(value);
}
export function parseMatrixifyBaseline(csv: string, catalog: readonly CatalogRecord[], cfg: MatrixifyConfiguration) {
  if (!csv || Buffer.byteLength(csv) > MATRIXIFY_BASELINE_MAX_BYTES) throw new WorkflowError("BASELINE_FILE_SIZE_INVALID", 400);
  let headers: string[] = [];
  let rows: Record<string, string>[];
  try {
    rows = parse(csv, { bom: true, columns: (fields: string[]) => {
      headers = fields;
      if (new Set(fields).size !== fields.length || fields.length > 150) throw new Error("headers");
      return fields;
    }, skip_empty_lines: true, max_record_size: 100_000, to: 60_001 }) as Record<string, string>[];
  } catch { throw new WorkflowError("BASELINE_CSV_INVALID", 400); }
  const available = `Inventory Available: ${cfg.location.name}`, committed = `Inventory Committed: ${cfg.location.name}`;
  const required = ["ID", "Variant ID", "Variant SKU", "Variant Price", "Variant Inventory Tracker",
    "Title", "Vendor", "Status", "Option1 Name", "Option1 Value", available, committed];
  if (!required.every(h => headers.includes(h))) throw new WorkflowError("BASELINE_REQUIRED_LOCATION_COLUMNS_MISSING", 400);
  if (!catalog.length || catalog.length > 60_000 || rows.length !== catalog.length)
    throw new WorkflowError("BASELINE_FULL_CATALOG_COVERAGE_REQUIRED", 400);
  const grouped = new Map<string, Record<string, string>>();
  let previousProduct = "";
  for (const r of rows) {
    const product = r.ID || previousProduct;
    if (!product) throw new WorkflowError("BASELINE_PRODUCT_ID_REQUIRED", 400);
    const previous = grouped.get(product);
    // Matrixify can leave repeated product fields empty on subsequent variant
    // rows. Carry only explicitly supplied fields within an identified product.
    if (!r.Title && previous) {
      for (const field of ["Title", "Vendor", "Status", "Option1 Name", "Option2 Name", "Option3 Name"])
        if (!r[field]) r[field] = previous[field] ?? "";
    }
    r.ID = product; grouped.set(product, { ...r }); previousProduct = product;
  }
  const byVariant = new Map(rows.map(r => [r["Variant ID"], r]));
  if (byVariant.size !== rows.length) throw new WorkflowError("BASELINE_DUPLICATE_VARIANT_ID", 400);
  const variants: VerifiedSyncVariant[] = [];
  for (const c of catalog) {
    const r = byVariant.get(shopifyNumericId(c.variant_gid, "ProductVariant"));
    if (!r || r.ID !== shopifyNumericId(c.product_gid, "Product") || r["Variant SKU"] !== (c.sku ?? ""))
      throw new WorkflowError("BASELINE_CATALOG_IDENTITY_MISMATCH", 400);
    const options = [1, 2, 3].filter(i => r[`Option${i} Value`] !== undefined && r[`Option${i} Value`] !== "")
      .map(i => ({ name: r[`Option${i} Name`] ?? "", value: r[`Option${i} Value`] }));
    const canonicalOptions = (values: typeof options) => JSON.stringify([...values].sort((a, b) => a.name.localeCompare(b.name)));
    if (!options.length || options.some(o => !o.name) || canonicalOptions(options) !== canonicalOptions(c.selected_options)
      || `${r.Title} · ${options.map(o => o.value).join(" / ")}` !== c.title || r.Vendor !== (c.vendor ?? ""))
      throw new WorkflowError("BASELINE_PRODUCT_OPTIONS_OR_VENDOR_CHANGED", 400);
    if (!c.inventory_item_gid || !/^gid:\/\/shopify\/InventoryItem\/[1-9]\d*$/.test(c.inventory_item_gid))
      throw new WorkflowError("CATALOG_INVENTORY_ITEM_MISSING", 400);
    if (r["Variant Price"] && !/^\d+(\.\d{1,2})?$/.test(r["Variant Price"]))
      throw new WorkflowError("BASELINE_PRICE_INVALID", 400);
    variants.push({ variantId: c.variant_gid, productId: c.product_gid, inventoryItemId: c.inventory_item_gid,
      // SQL active is cache membership, NOT the Shopify product status.
      identityFingerprint: c.identity_fingerprint, sku: c.sku ?? "", active: c.active && r.Status.toUpperCase() === "ACTIVE",
      tracked: r["Variant Inventory Tracker"] === "shopify",
      locationId: cfg.location.id, locationActive: true, quantity: quantity(r[available]),
      committedQuantity: quantity(r[committed]), price: r["Variant Price"] });
  }
  return variants;
}
