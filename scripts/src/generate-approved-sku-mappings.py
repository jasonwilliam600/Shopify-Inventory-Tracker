"""Materialize the merchant-approved comparison as exact, supplier-scoped candidates.

Run manually after explicit approval of this comparison. This never writes to
Shopify or the database, and does not infer rules for unseen supplier products.
"""
import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / "reports/store-catalog-comparison"
OUTPUT = ROOT / "artifacts/api-server/src/lib/approved-catalog-sku-mappings.json"


def rows(name):
    with (REPORT / name).open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def main():
    summary = json.loads((REPORT / "summary.json").read_text())
    evidence = rows("mapping-suggestions-for-review.csv")
    store_counts = Counter(row["Store SKU"].strip() for row in rows("store-variants.csv"))
    targets = defaultdict(set)
    flagged = defaultdict(dict)
    rule_counts = Counter()
    for row in evidence:
        supplier, source, target = row["Supplier"], row["Supplier SKU"].strip(), row["Store SKU"].strip()
        source_prefix, target_prefix = row["Supplier prefix"], row["Store prefix"]
        # The comparison escapes formula-leading cells for spreadsheet safety.
        raw_separator = row["Store separator"]
        separator = "" if raw_separator == "(none)" else "-" if raw_separator == "'-" else raw_separator
        delimiter = "-" if supplier == "Walthers" else r"[ /:_-]?"
        match = re.fullmatch(re.escape(source_prefix) + delimiter + r"([A-Za-z0-9].*)", source)
        if not match or target.casefold() != (target_prefix + separator + match.group(1)).casefold():
            raise ValueError(f"Full part number or format differs: {supplier} {source} -> {target}")
        if store_counts[target] != 1:
            raise ValueError(f"Store SKU is missing or ambiguous: {target}")
        targets[(supplier, source)].add(target)
        if row["Review flags"]:
            flagged[supplier][source] = row["Review flags"]
        rule_counts[(supplier, source_prefix, target_prefix, separator)] += 1
    for rule in summary["proposedRules"]:
        key = (rule["supplier"], rule["sourcePrefix"], rule["storePrefix"], rule["separator"])
        if rule_counts[key] != rule["evidenceCount"]:
            raise ValueError(f"Evidence count differs for {key}")
    mappings = defaultdict(dict)
    for (supplier, source), candidates in sorted(targets.items()):
        # A null entry deliberately blocks fallback prefix rules for conflicts.
        mappings[supplier][source] = next(iter(candidates)) if len(candidates) == 1 else None
    result = {
        "catalogComparedAt": summary["comparedAt"],
        "kind": "approved identifier candidates; not live Shopify variant verification",
        "approvedRuleCount": len(summary["proposedRules"]),
        "candidateCount": sum(value is not None for items in mappings.values() for value in items.values()),
        "blockedOfferCount": sum(value is None for items in mappings.values() for value in items.values()),
        "mappings": dict(mappings),
        "reviewFlags": dict(flagged),
    }
    OUTPUT.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({key: value for key, value in result.items() if key not in ("mappings", "reviewFlags")}))
    print("Product/units review flags:", sum(len(items) for items in flagged.values()))


if __name__ == "__main__":
    main()