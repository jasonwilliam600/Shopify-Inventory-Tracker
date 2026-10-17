# Supplier inventory and Shopify Admin visibility

## Established business rules

1. Combine individual-piece quantities from **all four eligible suppliers** for
   each correctly matched Shopify variant. Do not choose one supplier's stock.
2. Apply the existing approved safety buffer and cap **once**, to the combined
   amount, preserving the existing Shopify location's committed-stock deduction:
   `min(cap, max(0, sum(eligible supplier pieces) - buffer - committed))`.
3. Preserve all 209 holds, verified variant identities, mapping/unit approvals,
   feed freshness, lower-bound policy and duplicate/collision protection.
   Unmatched, held, stale or unknown quantities are not silently added.
   Do not zero stock from incomplete supplier coverage.
4. HobbyTyme On Hand is already pieces. Ordering-pack sizes never multiply it.
   A pack size can divide a verified pack COST, not a piece inventory quantity.
5. Pricing basis is the **lowest verified fresh eligible per-piece supplier
   cost**, excluding out-of-stock or ineligible sources. Compare exact rational
   costs before rounding. Selling-price formula/percentage remains subject to
   owner approval and all live-write gates.

The planner retains every contributor's original supplier SKU, mapping revision
and source fingerprint. Execution checks all contributors and the full
relationship fingerprint, not just one chosen supplier. Detail displays remain
individual even though eligible quantities are combined for inventory.

## Exact metafield definition proposal

Prepared in `artifacts/api-server/src/lib/supplier-variant-metafields.ts`.

All definitions have:

- Owner: `PRODUCTVARIANT`
- App-owned namespace: `$app:tsh_inventory_sync`
- Admin access: `MERCHANT_READ` (staff-readable, not merchant-editable values)
- Storefront API access: `NONE`
- Customer Account API access: `NONE`

| Key | Type | Presentation |
| --- | --- | --- |
| `supplier_availability` | `json` | Structured four-supplier record, schemaVersion 1 |
| `heartland` | `multi_line_text_field` | Readable Heartland supplier summary |
| `hobbytyme` | `multi_line_text_field` | Readable HobbyTyme supplier summary |
| `walthers` | `multi_line_text_field` | Readable Walthers supplier summary |
| `mmd_squadron` | `multi_line_text_field` | Readable MMD/Squadron supplier summary |

Shopify resolves the reserved namespace to the actual app's canonical
`app--<app-id>--tsh_inventory_sync` namespace. Never guess the app ID or borrow
another app's namespace.

Each supplier row contains supplier name, original trusted supplier SKU,
mapping status, piece quantity, exact/lower/upper-bound kind, freshness or
out-of-stock status, quantity/pricing eligibility, verified piece cost with
original pack-cost basis where applicable, and the last successful per-record
inventory timestamp. Unknown values remain null, not invented zeros. Stale
quantities remain labeled and excluded. Held/ambiguous relationships cannot
expose their SKU/quantity/cost as a trusted variant match.

Native Admin presentation uses the **four readable summaries**, not the JSON
field. Pin those definitions in Shopify's variant metafield section when the
store/Admin version supports it. For a multi-variant product, open the relevant
variant; this does not create a product-level all-variants panel. If pinning is
unsupported or at its limit, keep the definitions available in the variant's
metafield/custom-data view. Never unpin unrelated merchant fields.

No Admin UI extension is required for this native presentation. A custom
extension has not been deployed, nor is it needed to meet this first view.

## Implemented guarded write preparation

The existing synchronization planner now includes `supplier_metafields`
operations when the policy enables them and all five existing values/digests
have been read. Explicit null means the key was read and is absent; an omitted
key means no safe baseline and blocks that metafield operation.

The operation sets five fields atomically using `metafieldsSet`, includes each
`compareDigest` (null for create-only), and participates in the same exact-plan
owner approval, durable intent, preflight, readback and uncertain-outcome gates
as other synchronization operations. Unchanged values produce no write.

The transport contract requires private definition verification immediately
before execution. Public/mismatched/missing definitions, a changed contributor,
changed relationship, API/user errors, partial results, wrong variant IDs or
wrong readback values block confirmation. Do not silently repair definitions,
change permissions or omit compareDigest. The module also provides pure query,
definition, pin and write payloads and response/privacy validation helpers.

Each operation contains all source dependencies. Sources with held
relationships remain held even if someone marks a database mapping approved.
Metafield-only updates can clear unsafe/obsolete supplier details without
changing Shopify inventory. Correctly matched inactive/untracked variants can
receive supplier visibility without enabling tracking, activation or stock.

## Approval boundaries and remaining live requirements

**No definitions, pins or values have been written to Shopify.** No inventory or
price has changed. Automatic synchronization remains disabled.

1. Existing installation identity and granted scopes must be verified using the
   authorized transport. Variant metafield writes require `write_products`
   access; there is no separate generic `write_metafields` scope to request.
   Existing read-only permission must not be assumed to allow these writes.
2. Read existing definitions, access, canonical namespace and pin state. Stop on
   conflicts or incomplete results. Do not overwrite unrelated keys/definitions.
3. Present exact definitions and requested four pins for explicit configuration
   approval. They are live Shopify writes, even though no inventory is changed.
4. Read the five current values and compareDigest baselines for a small reviewed
   set of actual variant IDs. Produce the exact before/after dry run.
5. Obtain explicit approval for that controlled write. The installation/write
   transport remains an integration prerequisite; these pure payloads do not
   authenticate or issue any Shopify requests.
6. Final selling-price calculations and recurring activation remain separately
   gated. No stock-selection decision is reopened.

No database migration, new service, paid infrastructure or Shopify location is
needed to prepare these metafields. Existing journal SQL remains a separately
approved prerequisite before executing a durable live synchronization plan.

## Shopify API documentation checked (2026-07)

- https://shopify.dev/docs/api/admin-graphql/2026-07/input-objects/MetafieldAccessInput
- https://shopify.dev/docs/api/admin-graphql/2026-07/enums/MetafieldAdminAccessInput
- https://shopify.dev/docs/api/admin-graphql/2026-07/enums/MetafieldStorefrontAccessInput
- https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/metafieldDefinitionPin
- https://shopify.dev/docs/api/admin-graphql/2026-07/mutations/metafieldsSet
