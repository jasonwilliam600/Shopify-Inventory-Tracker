---
name: Independent wholesaler inventory
description: Preserve independent stock and pricing across wholesalers, including overlapping SKUs.
---

Keep wholesalers separate, including stock and wholesale pricing for the same SKU. The user chose Walthers as an additional wholesaler alongside Heartland and HobbyTyme.

**Why:** The user explicitly chose “Keep both wholesalers separate” when connecting Heartland Hobby Wholesale alongside HobbyTyme, rather than restricting Heartland to new SKUs or replacing existing supplier data. They subsequently asked to add Walthers, not replace an existing wholesaler.

**How to apply:** New supplier integrations and imports must retain each wholesaler's offer independently. Never replace another wholesaler's stock or pricing simply because the SKU matches. Supplier identifiers are not verified Shopify matches; any cross-supplier or store mapping needs evidence.

Use the Walthers dealer portal at `https://dealers.walthers.com/` when investigating its wholesale inventory source, rather than assuming the public retail website supplies dealer quantities or pricing.

**Why:** The user supplied this portal as the source for connecting Walthers.

**How to apply:** Verify the inventory export or read-only dealer data interface behind that portal before choosing a feed format, quantity interpretation, or manufacturer mapping.

COMBINE available inventory from all active, eligible suppliers for each correctly
matched Shopify variant. Apply the approved safety buffer/cap before publishing.
This is an established requirement; do not ask the user to reconsider it or
offer single-supplier selection instead.

**Why:** The user reiterated that combined stock is already decided, after an
implementation incorrectly selected a single supplier.

**How to apply:** Combine only eligible verified relationships; keep supplier
records individually visible and do not double-count records or confuse packs
with individual pieces. Preserve all 209 source holds and existing mapping
safeguards. Do not add physical-store stock to supplier availability.

The user requires INDIVIDUAL SUPPLIER VISIBILITY INSIDE SHOPIFY: supplier,
quantity, original supplier SKU, verified cost and last successful inventory
update, using appropriate variant metafields with readable Admin presentation
where supported.

**Why:** The user explicitly required this information in Shopify, not only the
Replit dashboard.

**How to apply:** Keep every supplier's offer separate in the detail display even
though eligible quantities are combined for sellable-stock calculations.

Supplier count must be expandable, not permanently limited to four.

**Why:** The owner's final directive explicitly plans many additional suppliers
and preserves COMBINE plus the lowest verified eligible per-piece cost as settled
business requirements.

**How to apply:** Preserve the current integrations during Phase 1. In the
backlogged scalability phase, drive eligibility, combination, minimum cost and
structured supplier visibility from active supplier configuration, applying
buffers/caps once to the total rather than per supplier.
Metafield definitions/values are live Shopify writes and require explicit
approval. Do not expose supplier costs to storefront/customer APIs.

Use the LOWEST verified eligible supplier cost as the pricing basis. Final
selling-price calculations require the user's approval.

**Why:** The user explicitly established this pricing-basis rule.

**How to apply:** Normalize only verified pack costs to individual units before
comparison; do not use MSRP, unknown pack units or held/ineligible offers. Do not
activate automatic synchronization or execute live Shopify writes without
explicit approval.

The user requested automatic Heartland inventory pulls every 30 minutes.

**Why:** The user explicitly chose "every 30 minutes please" rather than the offered hourly schedule.

**How to apply:** Preserve that Heartland cadence when changing supplier refresh behavior; do not apply it to other wholesalers without a separate request.
