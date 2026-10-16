"""Read-only review of the approved offline comparison; no app/store mutations."""
import csv
import html
import json
import re
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INPUT = ROOT / "reports/store-catalog-comparison"
OUT = ROOT / "reports/pre-sync-safety-review"
CONFLICT_SKUS = {
    "BAC17161", "BAC19902", "BAC16870", "BAC19568", "BLI7826",
    "JTC-405314", "BEV-261-3", "TAK-2041", "HBB-82455",
}


def read_csv(name):
    with (INPUT / name).open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def write_csv(name, rows):
    if not rows:
        raise ValueError(f"No review records for {name}")
    with (OUT / name).open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        for row in rows:
            writer.writerow({
                k: "'" + str(v) if str(v).startswith(("=", "+", "-", "@")) else v
                for k, v in row.items()
            })


def disposition(row):
    source = row["Supplier SKU"]
    if source.startswith(("CPA", "CPD")):
        return ("Reject candidate: different product class",
                "Supplier title describes separate PE/resin/brass/wheel accessories or decals; store title describes a complete aircraft kit. Preserve CPA/CPD namespaces; do not use the kit's stock.")
    if source == "ICM72075":
        return ("Reject candidate: different product",
                "Supplier is an ICM I-153 Finnish aircraft; store is an IBG V3000SM Maultier halftrack. Matching 72075 does not establish identity.")
    if source == "ILK63502":
        return ("Hold: store scale correction needed",
                "Saved MMD title and Squadron's linked ILK63502 listing specify 1/35; the store title says 1/25. Likely store description error, not verified stock eligibility.")
    if row["Review flags"].startswith("Volume differs"):
        return ("Hold: packaging/selling-unit confirmation",
                "Current Vallejo documentation supports 18ml Model Color and 35ml Wash FX. Supplier titles say 17ml/30ml. Possible legacy descriptions/packaging, not proof of the supplied bottle version or per-unit stock/price basis.")
    raise ValueError(f"Unhandled flagged candidate: {source}")


def duplicate_category(sku, entries):
    preorder = [bool(re.search(r"pre[- ]?order", x["Title"] + " " + x["Handle"], re.I)) for x in entries]
    if sku in CONFLICT_SKUS:
        return ("Different-product SKU collision", "Verify the manufacturer part for each listing and correct the misassigned SKU only after approval. Do not merge or select a listing automatically.")
    if any(preorder) and not all(preorder):
        return ("Preorder plus regular listing", "Decide whether to retain both listings. Select a live variant explicitly and keep preorder handling separate; do not give both listings the full supplier quantity.")
    if all(preorder):
        return ("Two preorder listings", "Likely duplicate preorder pages; verify release/edition and choose a canonical live variant. Preserve preorder policy and order history.")
    if sku == "AIC-2403":
        return ("Updated-version ambiguity", "One title explicitly says Updated Version. Verify whether both editions must remain before choosing a canonical variant.")
    if sku == "EXL55779":
        return ("Part-number metadata ambiguity", "One title says Excel 155779 while the shared SKU and other title say 55779. Verify the product code; do not guess a correction.")
    return ("Likely same-product duplicate", "Titles appear to describe the same product with different detail. This is a review classification, not verified identity. Confirm pack/edition/options, select one canonical live variant, and preserve order history; no automatic merge.")


def table(rows, columns):
    esc = html.escape
    return "<div class='table'><table><thead><tr>" + "".join(
        f"<th>{esc(c)}</th>" for c in columns
    ) + "</tr></thead><tbody>" + "".join(
        "<tr>" + "".join(f"<td>{esc(str(row[c]))}</td>" for c in columns) + "</tr>"
        for row in rows
    ) + "</tbody></table></div>"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    candidates = read_csv("mapping-suggestions-for-review.csv")
    flags = [row for row in candidates if row["Review flags"]]
    related = [row for row in candidates if not row["Review flags"] and
               (row["Supplier SKU"].startswith(("CPA", "CPD")) or row["Supplier SKU"] == "ICM72075")]
    reviewed = []
    for row in flags + related:
        status, reason = disposition(row)
        reviewed.append({
            "Scope": "Original 200 flagged candidates" if row["Review flags"] else "Additional related false candidate",
            "Supplier": row["Supplier"], "Supplier SKU": row["Supplier SKU"],
            "Proposed store SKU": row["Store SKU"], "Supplier title": row["Supplier title"],
            "Store title": row["Store title"], "Store handle": row["Store handle"],
            "Original flag": row["Review flags"], "Disposition": status,
            "Reason and action": reason, "Auto sync eligible": "No",
        })
    rejected = [row for row in reviewed if row["Disposition"].startswith("Reject")]
    write_csv("flagged-candidate-review.csv", reviewed[:len(flags)])
    write_csv("additional-false-candidates.csv", reviewed[len(flags):])
    write_csv("rejected-candidate-mappings.csv", rejected)
    groups = defaultdict(list)
    for row in read_csv("duplicate-store-skus.csv"):
        groups[row["Store SKU"]].append(row)
    duplicates = []
    for sku, entries in groups.items():
        if len(entries) != 2:
            raise ValueError(f"Expected two exported variants per duplicate group: {sku}")
        category, action = duplicate_category(sku, entries)
        duplicates.append({
            "Store SKU": sku, "Category": category,
            "Title 1": entries[0]["Title"], "Handle 1": entries[0]["Handle"],
            "Options 1": entries[0]["Options"], "Title 2": entries[1]["Title"],
            "Handle 2": entries[1]["Handle"], "Options 2": entries[1]["Options"],
            "Recommended action": action, "Auto sync eligible": "No",
        })
    write_csv("duplicate-sku-review.csv", duplicates)
    # Keep existing supplier-overlap evidence for all 154 groups, including
    # currently unflagged candidate namespaces that could also reach a collision.
    links = []
    for row in read_csv("ambiguous-matches.csv"):
        links.append({"Supplier": row["Supplier"], "Supplier SKU": row["Supplier SKU"],
                      "Store candidate": row["Approved store candidate"],
                      "Competing variants": row["Conflicting store variants"]})
    write_csv("existing-ambiguous-supplier-offers.csv", links)
    older_scales = [r for r in read_csv("identifier-matches-needing-product-review.csv")
                    if r["Review flags"].startswith("Scale differs")]
    write_csv("older-scale-flags-not-cleared.csv", older_scales)
    summary = {
        "reviewedAt": datetime.now(timezone.utc).isoformat(),
        "catalogComparedAt": json.loads((INPUT / "summary.json").read_text())["comparedAt"],
        "originalFlaggedCandidatesReviewed": len(flags),
        "originalFlagCounts": dict(Counter(row["Review flags"] for row in flags)),
        "additionalRelatedCandidatesReviewed": len(related),
        "falseCandidateMappingsIdentified": len(rejected),
        "duplicateSkuGroupsReviewed": len(duplicates),
        "duplicateVariantRowsReviewed": sum(map(len, groups.values())),
        "duplicateCategories": dict(Counter(row["Category"] for row in duplicates)),
        "olderScaleFlagsNotCleared": len(older_scales),
        "autoSyncClearedByReview": 0,
        "changes": "Read-only review; no application mappings, database, store SKUs, stock, prices, or Shopify state changed",
    }
    assert len(flags) == 200 and len(related) == 9 and len(rejected) == 12
    assert len(duplicates) == 154 and sum(map(len, groups.values())) == 308
    assert summary["duplicateCategories"]["Different-product SKU collision"] == 9
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    sources = json.loads((OUT / "verified-web-evidence.json").read_text())
    source_list = "".join(f"<li><a href='{html.escape(s['url'], quote=True)}'>{html.escape(s['title'])}</a></li>" for s in sources)
    counts = [{"Category": key, "Groups": value} for key, value in summary["duplicateCategories"].items()]
    document = """<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>TSH Pre-sync safety review</title>
<style>body{font:16px/1.55 system-ui,sans-serif;color:#203344;background:#f3f6f8;margin:0}main{max-width:1160px;margin:24px auto;padding:36px;background:#fff}h1{font-size:32px}h2{margin-top:32px}.note{padding:16px;background:#fff5df;border-left:4px solid #bc8423}.table{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:10px;text-align:left;border-bottom:1px solid #dbe4e8;vertical-align:top}th{background:#eef3f6}a{color:#175b86}details{margin:24px 0}summary{cursor:pointer;font-weight:650}small{color:#536b7b}@media(max-width:650px){main{padding:20px;margin:0}td{min-width:150px}}@media print{details{display:block}.table{overflow:visible}}</style><main>
<small>TSH Inventory Sync · Offline catalog review</small><h1>Pre-sync safety review</h1>
<p class="note"><strong>No reviewed item was cleared for automatic sync.</strong> This report classifies risks, not live Shopify variants. Existing publishing remains disabled. No application mapping, database, store listing, stock, or price was changed; the false candidates below are recommendations for quarantine, not already removed from the app.</p>
<h2>Findings</h2><ul><li><strong>200 original flagged candidates reviewed:</strong> 173 have 17ml/18ml differences, 23 have 30ml/35ml differences, one has a scale conflict, and three explicitly flagged accessory/kit conflicts.</li>
<li><strong>9 additional false candidates found:</strong> eight other Clear Prop accessory/decals candidates and one ICM-aircraft/IBG-halftrack mismatch. Together with the original three, <strong>12 candidate mappings should be quarantined.</strong></li>
<li><strong>196 Vallejo size differences:</strong> current manufacturer documentation supports 18ml Model Color and 35ml Wash FX. This suggests some older supplier wording, but does not prove bottle generation, contents, formulation equivalence, case quantities, or the wholesale stock/price basis. Retain the hold until supplied units and retail expectations are confirmed.</li>
<li><strong>ILK63502:</strong> saved supplier data and Squadron's linked product listing say 1/35; the store says 1/25. Likely store-title error. Verify the product and approve a description correction, rather than forcing a quantity conversion.</li></ul>
<h2>154 duplicate SKU groups · 308 exported variants</h2>""" + table(counts, ["Category", "Groups"]) + """
<p>All duplicate groups remain ineligible for automatic variant selection. “Likely same-product” describes title evidence only; differing packs, editions, release dates, and options still need verification. Do not give two listings the full supplier quantity or merge/delete pages without approval and live order-history checks.</p>
<h2>Recommended next actions</h2><ol><li>Quarantine the 12 false candidate mappings in the app, preserving original identifiers and blocking fallback rules.</li><li>Review the nine different-product duplicate groups first. Verify manufacturer part numbers before correcting misassigned SKUs.</li><li>Choose canonical live variants for genuine duplicates; retain separate preorder/version policies where appropriate.</li><li>Confirm Vallejo bottle generation and supplier quantity/price units; do not multiply stock by bottle volume or pack size.</li><li>When Shopify access returns, verify live variant/location IDs and run a read-only dry run before an inventory-only test batch.</li></ol>
<details open><summary>12 false candidate mappings</summary>""" + table(rejected, ["Supplier SKU", "Proposed store SKU", "Supplier title", "Store title", "Reason and action"]) + """
</details><details><summary>All 200 original flags</summary>""" + table(reviewed[:200], ["Supplier SKU", "Proposed store SKU", "Supplier title", "Store title", "Disposition"]) + """
</details><details><summary>All 154 duplicate groups</summary>""" + table(duplicates, ["Store SKU", "Category", "Title 1", "Handle 1", "Title 2", "Handle 2", "Recommended action"]) + """
</details><h2>Sources and limits</h2><ul>""" + source_list + """
</ul><p>The store comparison snapshot is 2026-10-05 00:16 UTC (October 4, 2026 Eastern), from the five uploaded product CSVs. Saved MMD catalog descriptions were checked read-only for 209 reviewed records. Supplier documentation is contextual evidence, not proof of the stock currently shipped. Other supplier stocks/units were not revalidated.</p>
<p>This review also preserves the 14 older scale flags in a separate CSV; those were not cleared by the mapping approval. The original comparison's manufacturer-label flags were not individually re-audited. Full catalog identity, unflagged pairs, selling units, Shopify status, variant IDs, location assignments, and order reservations are not certified. CSV row handles are not Shopify variant IDs.</p>
<p>Download bundle: item-level original-flag review, nine additional false candidates, all 12 rejected suggestions, all 154 duplicate groups, 48 existing ambiguous supplier offers, older scale flags, source excerpts, saved catalog evidence, and machine-readable summary. CSVs are escaped for spreadsheet formula safety.</p></main></html>"""
    assert len(document.encode()) < 5_242_880
    (OUT / "safety-review.html").write_text(document)
    with zipfile.ZipFile(OUT.with_suffix(".zip"), "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(OUT.iterdir()):
            archive.write(path, arcname="pre-sync-safety-review/" + path.name)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()