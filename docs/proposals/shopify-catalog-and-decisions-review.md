# Final SQL review — NOT EXECUTED

The application, Drizzle schema exports, startup routines, integrations, secrets,
database, Shopify configuration and publishing state are unchanged. Only proposal
documents are added. The SQL files are not registered with a migration runner.

## Files and approval boundary

- `shopify-catalog-and-decisions.forward.sql`: exact proposed development DDL,
  every literal source/target pair from both existing review CSVs, safety seeding,
  count assertions and commit, in one transaction.
- `shopify-catalog-and-decisions.rollback.sql`: proposed development rollback;
  requires separate approval if ever needed.

Approval of the table design is NOT approval to execute either SQL file.
Execution must target the confirmed development database only, with the reviewed
file unchanged. Do not execute either file, run a Drizzle push, publish, or run a
catalog import until the corresponding action is explicitly approved.

## Keys, indexes and data meaning

Catalog identity is `(shop, variant_gid)`, never SKU. Raw SKU text is retained;
`sku_key` trims surrounding whitespace but preserves case and punctuation. It
can be null for missing/blank SKUs. The SKU index is intentionally non-unique.
Other partial indexes support current product and snapshot lookups.

Mapping identity is `(shop, supplier, source_sku)`. `source_sku_key` uppercases
and trims only for conservative safety-hold lookup; it does not establish product
identity. The only foreign key is from the NEW decision table to the NEW catalog
table. No relationship points into an existing supplier or inventory table.

The partial unique approval index prevents approving two different source offers
from one supplier for the same Shopify variant. It does not combine suppliers.
Candidate/held collisions remain representable. Approval requires explicit
target ID, product/selling-unit verification flags, reviewer, time, catalog
snapshot and nonempty evidence. Those fields are requirements, not proof by
themselves: future application review must validate their actual evidence.

## All 209 holds persist

The exact 12 rejected and 200 flagged CSV relationships are embedded as literals.
All are currently MMD/Squadron. Three overlap, so the insert produces:

- 12 rejected source pairs, including their flagged evidence where applicable.
- 197 additional held source pairs.
- Zero approved/candidate decisions, target GIDs, product/unit approvals, or
  invented reviewer identities/timestamps.

Reasons and both rejection/flag indicators are retained. Initial target IDs are
null because no verified current Shopify IDs have been imported. Proposed SKU is
historical evidence, not an approved product match. The migration must abort if
the initial state does not match these counts and safety conditions.

The current code-level exclusion gate is NOT removed. Future DB-backed reads must
check that gate AND all DB held/rejected normalized source keys BEFORE exact SKU,
explicit item, or prefix matching. Deny takes precedence. Neither a new snapshot,
an exact match, a legacy reviewed flag, nor a newly inserted approval may
automatically override a remaining source hold. Changing a hold requires an
explicit item-level review and a separately approved policy transition.

The schema alone is not a database-wide publication authorization system. There
is no publishing endpoint/worker or new Shopify write transport in this proposal.

## Duplicate and missing SKUs

Retain every variant under its real ID; never upsert by SKU. Group current
non-null `sku_key` values and flag counts greater than one. Missing keys remain
visible and unmatched. Duplicate-SKU candidates remain effectively held, including
any prior stored approval affected by a later catalog change, until explicit
resolution. Never rename, delete, merge or choose a product automatically.

## Current-catalog import: later, separately authorized work

The existing connectivity helper proves shop-name access only. It does not expose
a reusable catalog reader or prove granted `read_products` access. Preserve the
independently supplied connection; do not replace it or use the broken connector.
Before any import, establish an approved read-only transport using that connection.
If this requires an authentication change outside the Agent's supported workflow,
report the blocker rather than adding a new token flow or changing permissions.

1. Confirm shop identity and granted scope handles with read-only queries.
2. Require existing product-read access. If missing, stop; do not alter scopes.
3. Read `productVariantsCount(limit: null) { count precision }`; its default cap
   is 10,000, so a default/capped result cannot validate this catalog.
4. Page every product variant, including products not published to a storefront:
   ID, SKU, title/options, updated time, parent ID/title/status. Use advancing
   cursors, inspect GraphQL errors, respect query cost, and reject duplicate IDs
   or incomplete pages. Do not query stock quantities, inventory items, or
   locations for this phase.
5. Stage outside active catalog rows. No selected fields from the historical
   export are treated as current Shopify IDs.
6. Verify exact count/completeness and reconcile changes during pagination.
   Shopify paging is NOT an atomic catalog snapshot; preserve observation times
   and do not call moving/incomplete data fully verified.
7. Under a per-shop importer lock and one PostgreSQL transaction, mark previous
   catalog rows non-current and upsert all staged variants by `(shop, variant_gid)`
   with a single snapshot ID, setting completion metadata and current flags only
   after validation. Retain removed variants as non-current, rather than
   deleting rows referenced by decisions. A failed/partial/zero-result initial
   import must not replace the historical read path or an existing snapshot.
8. Change the dashboard read path only after successful integration and checks.
   Read-side catalog completeness/recency, current membership, duplicate-SKU
   checks, collision checks and product/unit review remain separate trust gates.

Catalog import writes only the NEW local catalog table. It does not update source
inventory or mapping decisions, clear holds, or make any Shopify mutations.
No product-write, inventory-write, location, metafield or app-permission change is
required for this read-only visibility import.

## Rollback

Before commit: any failure requires ROLLBACK; the new tables and seed insert are
transactional. Execute forward SQL as one transaction, not unrelated sessions.

After commit: first switch any new readers/importers off and retain/restore the
historical read path and code-level safety gates. If new catalog/review data
exists, securely export ONLY those two tables to an ignored backup location and
verify the backup before any destructive rollback. With explicit rollback
approval, drop the decision table first, then the catalog table, using RESTRICT.
An unexpected dependency stops the rollback rather than cascading into other
objects. Dropping the new tables discards their new catalog/review data.

Existing supplier tables, records, refresh schedules and Shopify data require no
restoration because this migration does not change them.
