---
name: Walthers dealer data quality
description: Bulk-export pricing/flag limitations, SuiteCommerce search caps, and authentication verification traps.
---

Revalidate Walthers' bulk export before considering it a wholesale inventory source. When inspected on 2026-10-03, dealer prices were blank throughout that export and its boolean availability flags disagreed with authenticated product data. The authenticated catalog provided dealer prices, quantities, and per-product manufacturer names.

**Why:** Importing the bulk file without comparison would have lost wholesale pricing and misclassified availability. MSRP is not a substitute for dealer cost.

**How to apply:** Compare real products against the authenticated dealer catalog before changing data sources. Keep missing cost or quantity explicitly unknown rather than inventing values.

SuiteCommerce can return HTTP 400 with "Search failed" when a search exceeds its 5,000-result pagination window; that is not necessarily a credential failure.

**Why:** The complete Walthers catalog exceeded this window even though individual authenticated searches worked.

**How to apply:** Partition large searches with native facets, verify coverage against the complete catalog's count, and reject overlapping or incomplete downloads before replacing a supplier snapshot.

Native manufacturer and category facets do not necessarily cover every live catalog product. SKU-code text searches can recover omitted products, but also match descriptions and therefore overlap with other searches.

**Why:** Combining every returned manufacturer facet still fell short of the authenticated catalog's total. Independent SKU-code searches recovered the remaining records.

**How to apply:** Verify complete coverage by native product identity, not merely by enumerating every facet value. Deduplicate overlapping search results before counting quantities; do not confuse duplicate search hits with genuinely conflicting supplier SKU records.

The standalone profile service can omit the logged-in flag even for a successfully authenticated dealer. A fresh storefront environment includes that flag.

**Why:** Treating a missing standalone-profile flag as logout would reject a valid import.

**How to apply:** Verify live storefront authentication state rather than interpreting an omitted field as an authentication failure.