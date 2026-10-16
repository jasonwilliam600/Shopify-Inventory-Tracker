const fs = require("node:fs");
const path = require("node:path");
const dir = path.resolve("reports/store-catalog-comparison");
const s = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const num = value => Number(value).toLocaleString("en-US");
const date = new Intl.DateTimeFormat("en-US", { timeZone:"America/New_York", dateStyle:"long", timeStyle:"short" }).format(new Date(s.comparedAt));
const offersMatched = s.suppliers.reduce((n,row)=>n+row.exact+row.approved,0);
const ambiguous = s.suppliers.reduce((n,row)=>n+row.ambiguous,0);
if (s.variantsWithSku + s.blankSkuVariants !== s.variants || s.matchedStoreVariants + s.storeVariantsWithoutCurrentMatch !== s.variantsWithSku) throw new Error("Store totals do not reconcile");
if (s.suppliers.reduce((n,row)=>n+row.offers,0) !== s.supplierOffers || s.suppliers.some(row=>row.exact+row.approved+row.ambiguous+row.unmatched+row.caseOnly!==row.offers)) throw new Error("Supplier totals do not reconcile");
const rules = s.proposedRules.filter(r=>r.supplier==="MMD/Squadron").slice(0,15);
const formats = s.topVendors.filter(v=>["Tamiya","Trumpeter","Eduard","Vallejo"].includes(v.vendor));
const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TSH — Store SKU comparison</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f3f6f8;color:#182c3d;font:16px/1.6 system-ui,sans-serif}
main{max-width:1120px;margin:30px auto;background:white;padding:48px;border:1px solid #dce5ec;border-radius:12px}
h1{font-size:36px;line-height:1.18;margin:6px 0 20px}h2{font-size:23px;margin-top:36px}p,li{max-width:85ch}.eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#526c81}
.lead{font-size:19px}.note{background:#eef5fa;border-left:4px solid #276185;padding:15px 20px}.warn{background:#fff8e8;border-left:4px solid #b87d23;padding:15px 20px}
.table{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;border-bottom:1px solid #dfe7ed;padding:12px;vertical-align:top}th{background:#f4f7fa;font-weight:650}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}code{font-size:13px;background:#eef3f7;padding:2px 5px;border-radius:3px}.muted{color:#536779;font-size:13px}
dl{display:grid;grid-template-columns:1fr 1fr;gap:12px 24px}dl div{border-bottom:1px solid #dfe7ed;padding:8px 0}dt{font-size:14px;color:#536779}dd{margin:0;font-size:23px;font-weight:650}a{color:#175c87}
@media(max-width:700px){main{margin:0;border-radius:0;padding:24px 18px}h1{font-size:28px}dl{grid-template-columns:1fr 1fr}th,td{padding:9px}td{min-width:100px}}
@media print{body{background:white}main{margin:0;border:0;padding:0}.table{overflow:visible}h2{break-after:avoid}tr{break-inside:avoid}a{color:inherit}}
</style></head><body><main>
<div class="eyebrow">TSH Inventory Sync · Catalog snapshot</div><h1>Store SKU comparison</h1>
<p class="muted">Compared ${esc(date)} Eastern · Five uploaded Shopify product exports against the four saved development supplier catalogs.</p>
<p class="lead"><strong>${num(s.matchedStoreVariants)} store variants have a unique identifier match</strong> using exact SKUs or currently approved mappings. The export confirms mixed SKU formats: there is no universal hyphen rule.</p>
<div class="note"><strong>Read-only analysis.</strong> No store SKU, inventory quantity, price, database row, or mapping was changed. This comparison does not restore the Shopify connection or authorize stock publishing.</div>
<h2>What is in your store export</h2>
<dl><div><dt>Products</dt><dd>${num(s.products)}</dd></div><div><dt>Product variants</dt><dd>${num(s.variants)}</dd></div>
<div><dt>Distinct nonblank SKUs</dt><dd>${num(s.distinctSkus)}</dd></div><div><dt>Variants with an identifier match</dt><dd>${num(s.matchedStoreVariants)}</dd></div>
<div><dt>Duplicate SKU values</dt><dd>${num(s.duplicateSkuValues)}</dd></div><div><dt>Variants missing a SKU</dt><dd>${num(s.blankSkuVariants)}</dd></div></dl>
<p>${num(s.imageOnlyRows)} image-only export rows were excluded from variant counts. There were ${num(s.repeatedVariantRows)} repeated variant rows across the files and ${num(s.conflictingExportRows)} conflicting export rows.</p>
<h2>Matches by supplier</h2><div class="table"><table><thead><tr><th>Supplier</th><th class="num">Saved offers</th><th class="num">Exact identifier</th><th class="num">Approved mapping</th><th class="num">Ambiguous offers</th><th class="num">No current identifier match</th></tr></thead><tbody>
${s.suppliers.map(r=>`<tr><td>${esc(r.name)}</td><td class="num">${num(r.offers)}</td><td class="num">${num(r.exact)}</td><td class="num">${num(r.approved)}</td><td class="num">${num(r.ambiguous)}</td><td class="num">${num(r.unmatched+r.caseOnly)}</td></tr>`).join("")}
</tbody></table></div>
<p class="muted">${num(offersMatched)} matched supplier offers correspond to ${num(s.matchedStoreVariants)} store variants; totals overlap because the same store item can appear at several wholesalers. ${num(s.storeVariantsWithoutCurrentMatch)} nonblank-SKU store variants have no match under the current rules—not proof that suppliers do not carry them.</p>
<h2>SKU formatting must follow the existing item</h2>
${formats.map(v=>`<p><strong>${esc(v.vendor)}:</strong> ${v.formats.slice(0,4).map(f=>`${esc(f.prefix)} (${num(f.count)} variants; for example <code>${esc(f.examples[0])}</code>)`).join("; ")}${v.formats.length>4?"; additional product-series formats are retained in the vendor-format CSV":""}.</p>`).join("")}
<p>Keep alphabetic product-series codes, internal punctuation, and leading zeros. For example, Eduard <code>EDUEX1143</code> and <code>EDUFE1143</code> must never be treated as the same item just because they share 1143.</p>
<h2>Next MMD mappings supported by the export</h2>
<p>These are <strong>suggestions for approval, not enabled rules</strong>. Evidence requires the same normalized manufacturer/vendor and the full retained part number. Product descriptions and selling units still need review.</p>
<div class="table"><table><thead><tr><th>Manufacturer</th><th>Proposed prefix</th><th>Store separator</th><th class="num">Example pairs</th><th class="num">Pairs flagged for review</th></tr></thead><tbody>
${rules.map(r=>`<tr><td>${esc(r.manufacturer)}</td><td><code>${esc(r.sourcePrefix)} → ${esc(r.storePrefix)}</code></td><td>${r.separator?"Hyphen":"None"}</td><td class="num">${num(r.evidenceCount)}</td><td class="num">${num(r.flaggedExamples)}</td></tr>`).join("")}
</tbody></table></div>
<p>Start with <strong>MiniArt MIN → MIA (no hyphen)</strong>, <strong>Hobby Boss HBB → HBB (hyphen)</strong>, and <strong>ICM → ICM (hyphen)</strong>. Vallejo requires separate volume/pack review; an identifier alone does not verify individual bottles versus wholesale packs.</p>
<h2>Items requiring review</h2>
<div class="warn"><strong>${num(s.duplicateSkuValues)} SKU values belong to ${num(s.duplicateSkuVariants)} store variants.</strong> Some are preorder and regular listings; others have different product titles. ${num(ambiguous)} supplier offers encountered more than one possible store variant and were excluded from unique-match totals. Do not select a Shopify variant automatically in these cases.</div>
<p>${num(s.identifierMatchesNeedingProductReview)} uniquely matched supplier offers also have description-review flags. Most flags are differing manufacturer/vendor labels, which may simply be naming variations; scale or volume differences require separate checking. These flags are review prompts, not proven catalog errors.</p>
<h2>Files included in the comparison bundle</h2><ul>
<li><strong>matched-supplier-offers.csv:</strong> Every unique identifier match, original supplier SKU, store SKU, product titles, and review flags.</li>
<li><strong>mapping-suggestions-for-review.csv:</strong> Full supporting item pairs for unapproved mapping suggestions.</li>
<li><strong>duplicate-store-skus.csv</strong> and <strong>ambiguous-matches.csv:</strong> Store SKU collisions and competing variant matches.</li>
<li><strong>missing-store-skus.csv:</strong> The ${num(s.blankSkuVariants)} variants missing identifiers.</li>
<li><strong>identifier-matches-needing-product-review.csv:</strong> Label, scale, volume, and accessory/model-kit review prompts.</li>
<li><strong>store-variants-without-current-match.csv</strong> and <strong>unmatched-supplier-offers.csv:</strong> Unresolved records—not confirmed missing products.</li>
<li><strong>store-variants.csv</strong>, <strong>store-vendor-formats.csv</strong>, and <strong>store-skus-with-multiple-suppliers.csv:</strong> Store catalog, format evidence, and independent supplier overlap.</li>
<li><strong>summary.json:</strong> Machine-readable totals and snapshot dates.</li></ul>
<h2>Method and limitations</h2><ul>${s.limitations.map(text=>`<li>${esc(text)}</li>`).join("")}</ul>
<p class="muted">Comparison is case-sensitive after trimming outer SKU whitespace. No numeric-suffix-only matching was used. Suggestions preserve alphabetic product-series codes. Supplier records have different refresh dates: these are saved catalogs, not synchronized live stock. No available quantities or prices were combined, converted, or written to Shopify. CSV cells beginning with formula characters are escaped for spreadsheet safety.</p>
</main></body></html>`;
if (Buffer.byteLength(html,"utf8") > 5242880) throw new Error("Report exceeds size limit");
fs.writeFileSync(path.join(dir,"store-comparison.html"),html);
console.log("Report generated; store and supplier totals reconcile.",Buffer.byteLength(html,"utf8"),"bytes");