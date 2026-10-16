// Read-only comparison of Shopify product exports with the development supplier snapshot.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createRequire } = require("node:module");
const apiRequire = createRequire(path.resolve("artifacts/api-server/package.json"));
const dbRequire = createRequire(path.resolve("lib/db/package.json"));
const { parse } = apiRequire("csv-parse");
const { Pool } = dbRequire("pg");
const { mapSupplierSkuToStore } = require(process.argv[2]);
const out = path.resolve("reports/store-catalog-comparison");
fs.mkdirSync(out, { recursive: true });

function csvCell(value) {
  let text = String(value ?? "");
  // Prevent spreadsheet formulas in supplier/user-provided text.
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}
function writeCsv(name, headers, rows) {
  fs.writeFileSync(path.join(out, name), "\ufeff" + [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n"));
}
function canonical(value) { return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function skuParts(sku) {
  const match = sku.match(/^([A-Za-z+]+)([-/ _:]?)(.+)$/) || sku.match(/^(\d+)([-/ _:])(.+)$/);
  return match ? { prefix: match[1], separator: match[2], part: match[3] } : null;
}
function partsAtWidth(sku, width) {
  const prefix = sku.slice(0, width);
  const rest = sku.slice(width);
  const separator = /^[-/ _:]/.test(rest) ? rest[0] : "";
  const part = rest.slice(separator.length);
  return /^[A-Za-z0-9+]+$/.test(prefix) && part ? { prefix, separator, part } : null;
}
function storeComparisonParts(sku) {
  const parts = skuParts(sku);
  // Retain alphabetic product-series identifiers: EDUFE123 is EDU + FE123,
  // never just FE's numeric suffix. These are review suggestions, not rules.
  return parts && /^[A-Za-z+]{4,}$/.test(parts.prefix) ? partsAtWidth(sku, 3) : parts;
}
function supplierComparisonParts(offer) {
  if (offer.supplier !== "MMD/Squadron") return skuParts(offer.sku);
  if (/^VJ/.test(offer.sku) && canonical(offer.manufacturer) === "vallejo") return partsAtWidth(offer.sku, 2);
  if (/^(CP|UM)[-/ _:]?\d/.test(offer.sku)) return partsAtWidth(offer.sku, 2);
  return partsAtWidth(offer.sku, 3);
}
function reviewFlags(offer, variant) {
  const flags = [];
  const source = offer.product_name, store = variant.product.title;
  const scales = text => [...new Set((text.match(/\b1\s*[:/]\s*\d{2,4}\b/g) ?? []).map(s=>s.replace(/\s/g,"").replace(":","/")))];
  const a = scales(source), b = scales(store);
  if (a.length === 1 && b.length === 1 && a[0] !== b[0]) flags.push(`Scale differs: ${a[0]} vs ${b[0]}`);
  const volume = text => text.match(/\b(\d+(?:\.\d+)?)\s*ml\b/i)?.[1];
  const av = volume(source), bv = volume(store);
  if (av && bv && av !== bv) flags.push(`Volume differs: ${av}ml vs ${bv}ml`);
  if (offer.manufacturer && variant.product.vendor && canonical(offer.manufacturer) !== canonical(variant.product.vendor)) flags.push("Manufacturer/vendor labels differ — review");
  const accessory = text => /\b(?:canopy masks?|decal(?:s)?|photo.?etch|PE parts|instrument panel|exhaust|seat belts?)\b/i.test(text);
  const mainKit = text => /plastic model kit|\b(?:aircraft|fighter|tank|ship)\b.*\bkit\b/i.test(text);
  if ((accessory(source) && mainKit(store) && !accessory(store)) || (accessory(store) && mainKit(source) && !accessory(source))) flags.push("Accessory vs model-kit wording — review");
  return flags;
}
function get(map, key) { if (!map.has(key)) map.set(key, []); return map.get(key); }

async function main() {
  const archives = fs.readdirSync("attached_assets")
    .filter(name => /^products_export_[1-5].*17911591.*\.zip$/.test(name)).sort();
  if (archives.length !== 5) throw new Error("Expected all five uploaded export archives");
  const products = new Map(), variants = new Map(), conflicts = [], files = [];
  let repeatedVariantRows = 0, imageOnlyRows = 0;
  for (const archive of archives) {
    const number = archive.match(/^products_export_(\d)/)[1];
    const child = spawn("unzip", ["-p", path.join("attached_assets", archive), `products_export_${number}.csv`]);
    const done = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", code => code === 0 ? resolve() : reject(new Error(`Unable to read ${archive}`)));
    });
    child.stderr.resume();
    const parser = child.stdout.pipe(parse({ columns: true, bom: true, skip_empty_lines: true }));
    let rowCount = 0, variantRows = 0;
    for await (const row of parser) {
      rowCount++;
      if (!Object.hasOwn(row, "Variant SKU") || !Object.hasOwn(row, "Handle")) throw new Error("Missing Shopify SKU/Handle columns");
      const handle = row.Handle.trim();
      if (!handle) throw new Error(`Missing product handle in ${archive}, row ${rowCount}`);
      const product = products.get(handle) ?? { handle, title: "", vendor: "" };
      if (row.Title) product.title = row.Title;
      if (row.Vendor) product.vendor = row.Vendor;
      products.set(handle, product);
      const sku = row["Variant SKU"].trim();
      const options = [row["Option1 Value"] ?? "", row["Option2 Value"] ?? "", row["Option3 Value"] ?? ""];
      if (!sku && !options.some(Boolean)) { imageOnlyRows++; continue; }
      variantRows++;
      const key = JSON.stringify([handle, ...options]);
      const variant = { key, product, sku, options, file: archive, row: rowCount + 1 };
      const old = variants.get(key);
      if (old) {
        repeatedVariantRows++;
        if (old.sku !== sku) conflicts.push([handle, options.join(" / "), old.sku, sku, old.file, archive]);
      } else variants.set(key, variant);
    }
    await done;
    files.push({ archive, csvRows: rowCount, variantRows });
  }

  const bySku = new Map(), byFoldedSku = new Map(), brandParts = new Map(), vendorStats = new Map();
  const blank = [], invalid = [], whitespace = [];
  for (const variant of variants.values()) {
    const { sku, product } = variant;
    if (!sku) { blank.push(variant); continue; }
    get(bySku, sku).push(variant);
    get(byFoldedSku, sku.toUpperCase()).push(variant);
    if (/[^\x20-\x7e]/.test(sku)) invalid.push(variant);
    const split = skuParts(sku);
    const comparisonParts = storeComparisonParts(sku);
    const vendor = product.vendor || "(blank vendor)";
    const stats = vendorStats.get(vendor) ?? { variants: 0, prefixes: new Map() };
    stats.variants++;
    get(stats.prefixes, split ? `${split.prefix}${split.separator || " (no separator)"}` : "(unstructured)").push(sku);
    vendorStats.set(vendor, stats);
    if (comparisonParts && product.vendor) {
      get(brandParts, `${canonical(product.vendor)}|${comparisonParts.part.toUpperCase()}`).push(variant);
    }
  }
  const duplicates = [...bySku].filter(([, records]) => records.length > 1);
  const storeRows = [...variants.values()].map(v => [v.sku, v.product.handle, v.product.title, v.product.vendor, ...v.options, v.file, v.row]);
  writeCsv("store-variants.csv", ["Store SKU", "Handle", "Title", "Vendor", "Option 1", "Option 2", "Option 3", "Source archive", "CSV row"], storeRows);
  writeCsv("duplicate-store-skus.csv", ["Store SKU", "Handle", "Title", "Vendor", "Options"], duplicates.flatMap(([sku, records]) => records.map(v => [sku, v.product.handle, v.product.title, v.product.vendor, v.options.join(" / ")])));
  writeCsv("missing-store-skus.csv", ["Handle", "Title", "Vendor", "Options"], blank.map(v => [v.product.handle, v.product.title, v.product.vendor, v.options.join(" / ")]));
  writeCsv("conflicting-export-rows.csv", ["Handle", "Options", "First SKU", "Other SKU", "First file", "Other file"], conflicts);
  writeCsv("store-vendor-formats.csv", ["Vendor", "Variant count", "Prefix / separator", "Count", "Example SKUs"], [...vendorStats].sort((a,b) => b[1].variants-a[1].variants).flatMap(([vendor,stats]) => [...stats.prefixes].sort((a,b) => b[1].length-a[1].length).map(([prefix,skus]) => [vendor,stats.variants,prefix,skus.length,skus.slice(0,4).join(" | ")])));

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  const client = await pool.connect();
  let offers;
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '120s'");
    const result = await client.query("SELECT supplier, sku, product_name, imported_fields->>'manufacturerName' AS manufacturer, supplier_updated_at FROM supplier_inventory ORDER BY supplier, sku");
    offers = result.rows;
    await client.query("COMMIT");
  } finally { client.release(); await pool.end(); }

  const matched = [], ambiguous = [], unmatched = [], caseOnly = [], proposals = new Map(), overlap = new Map(), reviewRows = [];
  const conflictedKeys = new Set(conflicts.map(row=>JSON.stringify([row[0], row[1]])));
  const supplierStats = new Map(), matchedStore = new Set(), matchedProducts = new Set();
  for (const offer of offers) {
    const { supplier, sku } = offer;
    const stats = supplierStats.get(supplier) ?? { offers: 0, exact: 0, approved: 0, ambiguous: 0, unmatched: 0, caseOnly: 0, storeSkus: new Set(), oldest: null, newest: null };
    stats.offers++;
    const date = offer.supplier_updated_at ? new Date(offer.supplier_updated_at).toISOString() : null;
    if (date) { if (!stats.oldest || date < stats.oldest) stats.oldest = date; if (!stats.newest || date > stats.newest) stats.newest = date; }
    supplierStats.set(supplier, stats);
    const candidate = mapSupplierSkuToStore(sku, supplier);
    const exact = bySku.get(sku.trim()) ?? [];
    const converted = candidate ? bySku.get(candidate) ?? [] : [];
    const choices = new Map([...exact, ...converted].map(v => [v.key, v]));
    const base = [supplier, sku, offer.product_name, offer.manufacturer ?? "", candidate ?? ""];
    const hasConflict = [...choices.values()].some(v=>conflictedKeys.has(JSON.stringify([v.product.handle,v.options.join(" / ")])));
    if (choices.size === 1 && !hasConflict) {
      const variant = [...choices.values()][0];
      const kind = exact.length ? "Exact identifier" : "Approved mapping";
      if (exact.length) stats.exact++; else stats.approved++;
      stats.storeSkus.add(variant.sku); matchedStore.add(variant.key); matchedProducts.add(variant.product.handle);
      get(overlap, variant.sku).push({ supplier, sku });
      const flags = reviewFlags(offer, variant);
      matched.push([...base, kind, variant.sku, variant.product.handle, variant.product.title, variant.product.vendor, flags.join(" | ")]);
      if (flags.length) reviewRows.push([...base, variant.sku, variant.product.handle, variant.product.title, flags.join(" | ")]);
      continue;
    }
    if (choices.size > 1 || hasConflict) {
      stats.ambiguous++;
      ambiguous.push([...base, [...choices.values()].map(v => `${v.sku} / ${v.product.handle} / ${v.options.join(" / ")}`).join(" | ")]);
      continue;
    }
    const folded = new Map([...(byFoldedSku.get(sku.trim().toUpperCase()) ?? []), ...(candidate ? byFoldedSku.get(candidate.toUpperCase()) ?? [] : [])].map(v => [v.key,v]));
    if (folded.size) {
      stats.caseOnly++;
      caseOnly.push([...base, [...folded.values()].map(v=>`${v.sku} / ${v.product.handle}`).join(" | ")]);
    } else {
      stats.unmatched++;
      unmatched.push(base);
    }
    // Suggestions require the full part number AND exact normalized manufacturer/vendor.
    // They never alter approved mappings or strip numeric suffixes alone.
    const parts = supplierComparisonParts(offer);
    if (!parts || !offer.manufacturer) continue;
    const related = brandParts.get(`${canonical(offer.manufacturer)}|${parts.part.toUpperCase()}`) ?? [];
    if (related.length !== 1 || (bySku.get(related[0].sku)?.length ?? 0) !== 1) continue;
    const variant = related[0], target = storeComparisonParts(variant.sku);
    if (!target) continue;
    const key = JSON.stringify([supplier, offer.manufacturer, parts.prefix, target.prefix, target.separator]);
    const rule = proposals.get(key) ?? { supplier, manufacturer:offer.manufacturer, sourcePrefix:parts.prefix, storePrefix:target.prefix, separator:target.separator, evidence:[] };
    rule.evidence.push({ sourceSku:sku, sourceTitle:offer.product_name, storeSku:variant.sku, storeTitle:variant.product.title, storeVendor:variant.product.vendor, handle:variant.product.handle, reviewFlags:reviewFlags(offer,variant) });
    proposals.set(key,rule);
  }
  const proposalList = [...proposals.values()].sort((a,b) => b.evidence.length-a.evidence.length);
  const headers = ["Supplier", "Supplier SKU", "Supplier product", "Supplier manufacturer", "Approved store candidate"];
  writeCsv("matched-supplier-offers.csv", [...headers, "Match basis", "Store SKU", "Store handle", "Store title", "Store vendor", "Review flags"], matched);
  writeCsv("identifier-matches-needing-product-review.csv", [...headers, "Store SKU", "Store handle", "Store title", "Review flags"], reviewRows);
  writeCsv("ambiguous-matches.csv", [...headers, "Conflicting store variants"], ambiguous);
  writeCsv("case-only-review.csv", [...headers, "Possible store variants — case differs"], caseOnly);
  writeCsv("unmatched-supplier-offers.csv", headers, unmatched);
  writeCsv("store-variants-without-current-match.csv", ["Store SKU", "Handle", "Title", "Vendor", "Options"], [...variants.values()].filter(v=>v.sku && !matchedStore.has(v.key)).map(v=>[v.sku,v.product.handle,v.product.title,v.product.vendor,v.options.join(" / ")]));
  writeCsv("mapping-suggestions-for-review.csv", ["Supplier", "Manufacturer", "Supplier prefix", "Store prefix", "Store separator", "Supporting examples", "Supplier SKU", "Store SKU", "Supplier title", "Store title", "Store handle", "Review flags"], proposalList.flatMap(rule=>rule.evidence.map(e=>[rule.supplier,rule.manufacturer,rule.sourcePrefix,rule.storePrefix,rule.separator || "(none)",rule.evidence.length,e.sourceSku,e.storeSku,e.sourceTitle,e.storeTitle,e.handle,e.reviewFlags.join(" | ")])));
  writeCsv("store-skus-with-multiple-suppliers.csv", ["Store SKU", "Supplier count", "Supplier", "Original supplier SKU"], [...overlap].filter(([, rows])=>new Set(rows.map(r=>r.supplier)).size>1).flatMap(([sku,rows])=>rows.map(r=>[sku,new Set(rows.map(r=>r.supplier)).size,r.supplier,r.sku])));
  const summary = {
    comparedAt:new Date().toISOString(), supplierSource:"Development database snapshot; not a live Shopify connection",
    files, products:products.size, variants:variants.size, variantsWithSku:variants.size-blank.length,
    distinctSkus:bySku.size, blankSkuVariants:blank.length, duplicateSkuValues:duplicates.length,
    duplicateSkuVariants:duplicates.reduce((n,[,rows])=>n+rows.length,0), repeatedVariantRows,
    imageOnlyRows, conflictingExportRows:conflicts.length, nonAsciiSkuVariants:invalid.length,
    matchedStoreVariants:matchedStore.size, matchedStoreProducts:matchedProducts.size,
    storeVariantsWithoutCurrentMatch:variants.size-blank.length-matchedStore.size,
    supplierOffers:offers.length,
    identifierMatchesNeedingProductReview:reviewRows.length,
    suppliers:[...supplierStats].map(([name,s])=>({ name, ...s, storeSkus:s.storeSkus.size })),
    proposedRules:proposalList.map(r=>({...r,evidenceCount:r.evidence.length,flaggedExamples:r.evidence.filter(e=>e.reviewFlags.length).length,evidence:r.evidence.slice(0,3)})),
    topVendors:[...vendorStats].sort((a,b)=>b[1].variants-a[1].variants).slice(0,35).map(([vendor,s])=>({vendor,variants:s.variants,formats:[...s.prefixes].sort((a,b)=>b[1].length-a[1].length).map(([prefix,skus])=>({prefix,count:skus.length,examples:skus.slice(0,3)}))})),
    limitations:[
      "Identifier matches are not confirmation of selling-unit, pack-size, price, or Shopify variant identity.",
      "Unmatched supplier offers are not automatically missing store products: unapproved mappings may still reconcile them.",
      "Rule suggestions use identical normalized manufacturer/vendor plus complete part number, preserving alphabetic product-series codes; titles still require review. Suggested three-character store prefixes are hypotheses, not approved mappings.",
      "Image-only rows are not counted as variants. No database, store SKU, stock, price, or mapping was modified.",
      "Store export completeness is user-supplied; no live Shopify catalog check was possible."
    ]
  };
  fs.writeFileSync(path.join(out,"summary.json"),JSON.stringify(summary,null,2));
  console.log(JSON.stringify({...summary,proposedRules:summary.proposedRules.filter(r=>r.supplier==="MMD/Squadron").slice(0,6),topVendors:[]},null,2));
}
main().catch(error=>{ console.error(error.message); process.exitCode=1; });