---
name: SKU matching and wholesale units
description: Retail paint selling units, wholesale pack sizes, and safe SKU reconciliation.
---

The user sells the Shopify 18ml paint listings as individual bottles. They stated: "Hobbytyme only sells the wholesale by 6 packs and 2 packs."

The user confirmed HobbyTyme's On Hand quantity is a piece count, not a pack count.

On 2026-10-16, the user stated: "No physical store stock exists currently."

**Why:** This is a merchant-provided operating fact, not a conclusion from legacy zero-valued database fields or a Shopify inventory query.

**How to apply:** Do not invent physical stock or add supplier quantities to it in supplier-visibility views. Reconfirm this fact before future publishing work rather than treating it as a permanent restriction on having physical inventory.

The user believes HobbyTyme's Net Price is per pack, but has not confirmed it.

**Why:** Comparing individual retail units directly with wholesale packs can misstate availability and unit costs.

**How to apply:** Keep supplier identifiers and Shopify SKUs separate with verified item-level mappings. Preserve On Hand as individual pieces; do not multiply it by pack size. Record wholesale ordering pack size separately per item. Treat per-pack Net Price as tentative and verify it against supplier documentation or an invoice before converting prices. Supplier availability must not overwrite Shopify's physical stock.

Do not match SKUs by numeric suffix alone.

**Why:** Different HobbyTyme vendor prefixes can share the same numeric part number for unrelated products. The observed Revell supplier prefix also differs from the Shopify prefix.

**How to apply:** Retain full original identifiers, require a verified vendor/product mapping, and flag ambiguities rather than automatically removing prefixes or punctuation. Do not rename Shopify SKUs merely to match a supplier.

Only classify supplier SKUs as absent from the store after comparing against a verified complete store catalog and any approved SKU mappings. While that catalog is unavailable, label supplier records as awaiting comparison.

**Why:** Zero store stock does not mean the product is absent, and matching against accumulated supplier imports does not prove store catalog membership.

**How to apply:** Keep unverified comparison candidates distinct from confirmed missing SKUs and do not use stock or review status as a catalog-membership test.

Full manufacturer identity plus a matching retained part number does not prove product identity when prefixes distinguish product classes.

**Why:** The offline safety review found Clear Prop `CP` kit numbers colliding with `CPA` accessory and `CPD` decal numbers. It also found an ICM aircraft incorrectly paired with an IBG halftrack under a mislabeled store vendor. Merchant approval of identifier suggestions did not verify these products.

**How to apply:** Keep kit, accessory, and decal namespaces distinct. Reject demonstrated product-class or model conflicts before assigning inventory, even when the numerical parts and vendor labels agree. Treat supplier descriptions and actual product identity as independent evidence; do not clear selling-unit warnings merely because a prefix mapping was approved.