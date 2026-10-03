---
name: MMD/Squadron dealer data
description: MMD's stock export and authenticated dealer catalog have different pricing and coverage semantics.
---

MMD's bulk-order stock export provides manufacturer/brand names, native SKUs, MSRP, and stock quantities, but not wholesale cost. Obtain dealer prices from the authenticated product catalog.

**Why:** The stock export's MSRP differed from the signed-in dealer price for the same product. Logged-out product pages could expose stock while hiding pricing.

**How to apply:** Revalidate the two sources before changing the importer. Never infer a universal discount or substitute MSRP for dealer cost. Check the dealer session throughout pagination and before committing.

Do not assume the stock export and storefront catalog cover exactly the same products. Missing MSRP is also legitimate in this export.

**Why:** The initial export contained blank MSRP values, and stock-export coverage is separate from published storefront listings.

**How to apply:** Keep unmatched dealer cost explicitly unknown, retain original export values, and report omissions for review instead of inventing prices or stock quantities.

The unfiltered MMD product listing silently stops at exactly 10,000 products. Native brand partitions, enumerated from the brand sitemap, expose dealer bulk-order tables with prices, manufacturer names, and live quantities.

**Why:** The first unfiltered crawl ended without a next link at 10,000 products while the stock export contained substantially more SKUs.

**How to apply:** Use all native brand partitions, deduplicate overlaps, and reject any partition reaching the same cap. Do not mistake an absent next link for proof that the unfiltered catalog is complete.

The merchant requested hourly automatic MMD/Squadron updates, with manual refresh still available. Leave other suppliers' schedules unchanged.

**Why:** The merchant requested “Set it for hourly updates if you havent already.”

**How to apply:** Preserve MMD's hourly cadence unless the merchant asks to change it.