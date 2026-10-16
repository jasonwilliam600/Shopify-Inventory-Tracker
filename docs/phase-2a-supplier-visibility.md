# Phase 2A: read-only supplier visibility

## Implemented without database migrations

The `/api/supplier-availability` read endpoint evaluates current supplier rows
from the existing PostgreSQL `supplier_inventory` table against the existing
historical Shopify CSV export. It never calls Shopify, starts supplier refreshes,
writes records, or uses the legacy `shopify_stock` value as actual inventory.

The existing Inventory page defaults to separate supplier observations. Source
review and existing supplier refresh pages remain available. No quantities are
added together. All displayed mappings are candidates or blocked, never verified.
HobbyTyme On Hand remains individual pieces. Other supplier units require review.

The October 5 export contains 42,309 variant rows, 154 duplicate SKU groups,
and 21 missing-SKU variants. It has no Shopify variant IDs and is not a live
catalog. Synthetic historical locators are explicitly not Shopify IDs. All
variants, including those without a supplier record, remain browsable.

The historical files under `reports/store-catalog-comparison` remain ignored
local reports; they are not copied into source or the build. When unavailable,
the API explicitly reports catalog-unavailable rather than substituting the
supplier database for a Shopify catalog. Do not publish this temporary historical
reader as a current catalog integration.

## Safety

The 12 rejected MMD source relationships are blocked across exact and prefix
fallbacks. All 200 review flags remain held (209 distinct source pairs in total).
Legacy "mark reviewed" actions do not approve these relationships.

Same-supplier collisions retain every source and remain non-trusted. Duplicate
store SKUs and multiple plausible target identifiers are held. Original feed
counts are reconciled with normalized quantities: missing/invalid/coerced zero
and contradictory records are unknown. MMD uses the preserved authenticated
dealer observation when that is the selected source. Bounds are never exact
counts. Stale observations retain their last reported quantity and timestamp,
not a current stock assertion.

Display warning windows are Heartland 90 minutes, HobbyTyme 24 hours, and
Walthers/MMD 3 hours. These are visibility defaults, not an approved publishing
policy. Timestamps are last local feed imports, not proof of upstream freshness.

There is currently no physical store stock, per the merchant. That fact is not
a Shopify quantity query and does not authorize future inventory writes.

## Proposed migration: NOT CREATED OR APPLIED — approval required

1. **shopify_variant_catalog**: shop identity, product GID, variant GID, SKU,
   product title/options, verification timestamp and catalog snapshot identifier.
   Primary key `(shop, variant_gid)`. Non-unique index on `(shop, sku)` so duplicate
   SKUs remain detectable. Persist only necessary catalog/mapping metadata.
2. **supplier_mapping_decisions**: shop, supplier, original source SKU, proposed
   target variant/relationship, decision, reason, reviewer and review time,
   product/selling-unit evidence. Index source and target identities. Rejections
   must remain enforceable before candidate fallbacks; corrected relationships
   require explicit reapproval.

Impact: additive schema only; no deletion, stock replacement, source-SKU rename,
supplier connection change, or Shopify mutation. A first catalog import would
populate only the new catalog table using separately authorized read-only
product access. Existing exclusions become review decisions, not approvals.
Catalog snapshot completion must be explicit so partial imports cannot appear
complete. Revalidate duplicate/missing SKUs against the fresh snapshot.

Do not apply a Drizzle schema push, create these tables, backfill them, retrieve
Shopify tokens, or import a current catalog until the migration and read path are
approved. Admin extensions and publishing are outside Phase 2A.

## Future prerequisites

Fresh Shopify variant identity, granted `read_products` verification, durable
review approvals, actual selling units, and an authenticated application boundary
are required before current trusted matching or an external Admin extension.
Future publishing needs its own permissions, fulfillment/location policy,
reservation accounting, audit trail, idempotency, and explicit activation.
