# TSH Inventory Sync: guarded Matrixify workflow

Development implementation only. No real catalog import, reviewer provisioning,
metafield definition creation, Shopify request, live import, automatic publishing
or database migration is performed by installing this code.

## Implemented

- Existing mapping manager retains historical diagnostics and candidate discovery.
  Signed-in, explicitly allowlisted reviewers can search the verified PostgreSQL
  catalog cache, approve an exact source relationship or revoke an approval.
- An approval atomically changes `supplier_mapping_decisions` and appends its exact
  before/after revision to `supplier_mapping_audit_events`. Existing constraints,
  normalized-source uniqueness and one-approved-offer-per-supplier/variant remain.
  Concurrent review conflicts require a reload, not automatic write retries.
- All 209 source holds (including the 12 terminal null rejections) are checked
  before SQL and again against the installed SQL registry. This workflow does not
  resolve holds or insert into `supplier_mapping_hold_resolutions`. Individually
  authorized corrections require their own exact evidence/resolution workflow.
- Identity and individual-piece confirmations are mandatory. An optional reviewed
  cost observation is stored in the existing selling-unit JSON snapshot, not a new
  table. It is bound to the exact amount and explicit piece/pack basis. Cost changes
  invalidate that observation; quantity refreshes do not pretend to refresh cost.
  HobbyTyme On Hand remains pieces even when its cost is confirmed per pack.
- `/matrixify` accepts an owner-attested, fresh Matrixify Products CSV baseline.
  It validates complete variant coverage, IDs, SKU, product/vendor/options, exact
  location headers, quantities, tracking and price data against the imported cache.
  The CSV never becomes a catalog import or independent reconciliation witness and
  never renews catalog verification timestamps.
- Shared synchronization planner combines only eligible suppliers, applies the
  existing buffer/commitment/cap calculation once and uses the lowest verified
  eligible per-piece cost. Prices remain preserve-only until a separate owner
  pricing approval is configured. Duplicate/missing SKUs, stale/unknown/bounded
  quantities, source holds and collisions produce exceptions rather than guesses.
- SQL `active` means catalog membership. Fresh CSV product status separately
  prevents inventory and price changes for draft/archived/unlisted products.
- Preview is reviewer-bound, paginated, fingerprinted and expires within the
  planner's existing maximum 300 seconds (or earlier source/cost expiration).
  Optional explicit variant IDs scope a controlled batch; global duplicate checks
  still use the complete catalog. The full baseline is required even for a batch.
- Download rechecks configuration, source data, mapping decisions and expiry.
  Any change requires a new preview. Confidential workbooks stream to the browser;
  no export files or input CSVs are persisted to disk, Git or public storage.
- No schema changes. No supplier schedule or import changes.

## Three separate Matrixify XLSX downloads

Each has one importable sheet named **Products**, plus **TSH Exceptions** and
**TSH Review** reports. Import only Products; report sheets are not import data.

All rows contain:

| Column | Value |
| --- | --- |
| `ID` | Exact numeric product ID, stored as XLSX text |
| `Command` | `UPDATE` |
| `Variant ID` | Exact numeric variant ID, stored as XLSX text |
| `Variant Command` | `UPDATE` |

Additional fields are limited by profile:

1. **Inventory:** only `Inventory Available: <exact existing location name>`.
2. **Supplier metadata:** five explicitly typed `Variant Metafield:` columns under
   the proposed merchant-owned `tsh_inventory_sync` namespace: JSON
   `supplier_availability` plus readable multiline `heartland`, `hobbytyme`,
   `walthers` and `mmd_squadron`. Each supplier remains separate.
3. **Prices:** only `Variant Price`, and only actual planned approved changes.

There is no SKU/handle/option fallback, product creation command, inventory-tracker
change, default-location quantity, adjustment command or blank price column in the
inventory file. IDs are never converted to JavaScript/Excel floating-point numbers.
User/feed strings remain text cells, not spreadsheet formulas.

### Important manual-import limitations

Matrixify is a separate application. These files do **not** inherit the direct API
executor's compare-and-set, lease, atomicity or readback guarantees. Shopify orders
and edits during a manual import can race an absolute quantity or price update.
Download is not approval to import. Review a small explicit batch, take a fresh
baseline immediately before it, and obtain approval for the exact live operation.
Do not automatically upload files, rerun old files or blindly replay partial imports.
Recover by inspecting Matrixify's result and preparing a fresh, reviewed corrective
plan; never overwrite newer orders with a stale reverse file.

## Genuine configuration/authorization prerequisites

1. **Reviewer identity:** configure supported Replit-managed Clerk authentication,
   then explicitly allowlist this environment's reviewer subjects in
   `MAPPING_REVIEWER_SUBJECTS` (comma-separated). No first-user-admin shortcut.
   Production identities must be separately established; development subjects are
   not production authorization. `MAPPING_AUTHORIZED_ORIGINS` contains exact
   approved origins; the existing development domain is the development fallback.
   Clerk keys use the supported managed setup, including automatic frontend/proxy
   configuration. Development authentication and managed keys are now provisioned;
   the owner's verified account still needs explicit allowlisting. No production
   identities or reviewer grants have been established.
2. **Catalog:** separately authorize the existing guarded catalog import after its
   archive/reconciliation requirements are satisfied. Historical October 5 candidates
   cannot approve mappings. The original export evidence collection stays closed.
   No historical/empty/stale cache is silently accepted.
3. **Owner configuration:** prepare a private, owner-only configuration outside
   public directories and Git. Set `MATRIXIFY_WORKFLOW_CONFIG` to its absolute path.
   File mode must be 0600, immediate parent 0700, same owner, no symlinks.
   Fill `config.example.json` with independently checked store/location observations
   and **already approved** safety values. The example is intentionally invalid until
   completed. Store currency must be verified USD. No arbitrary defaults establish
   owner approval. Location evidence must be current (within 24 hours).
4. **Pricing:** either use preserve-only mode or provide exact approved markup/margin
   basis points and an approval bound to `digest(policy.pricing)`. The digest is the
   SHA-256 of JSON with sorted object keys, as implemented by synchronization-plan.
   No selling-price formula has been approved by this implementation.
5. **Metafield access decision:** the completed direct-API design uses app-owned
   `$app:tsh_inventory_sync` fields with `MERCHANT_READ` access. Matrixify cannot
   write those fields as another app. They remain unchanged.

   A Matrixify-compatible merchant-owned namespace instead has Admin access
   `PUBLIC_READ_WRITE`: other Admin apps can read/write it. This does **not** mean
   public Storefront API access, which must remain `NONE`; customer-account access
   must also remain `NONE`. Nevertheless Storefront API `NONE` alone is not proof
   that a theme will never render cost data. This differs from app-owned isolation.
   **Owner approval of this access model and a documented theme-exposure review
   are mandatory before a supplier-metafield workbook is available.**

   If approved, separately approve/create the five merchant-owned variant
   definitions through supported Shopify administration, then supply their actual
   read-only definition/access observation, shop binding and timestamp. The app
   creates no definitions or pins and changes no permissions. With no approval or
   evidence, metadata download stays blocked; inventory and approved-price
   workbooks do not depend on weakening this gate.
6. **Baseline:** obtain a fresh Matrixify Products CSV using Basic/Variants and
   inventory-level fields, without extra image-only rows. Include ID, Variant ID,
   Variant SKU, Variant Price, Variant Inventory Tracker, Title, Vendor, Status,
   Option1 Name/Value (plus Option2/3 Name/Value where used),
   `Inventory Available: <location>` and `Inventory Committed: <location>`.
   One row per variant, complete catalog coverage. The observation time is entered
   explicitly and owner-attested, never inferred from file modification time.

These are enablement prerequisites, not authorization to perform them now.
Generating XLSX does not purchase or configure Matrixify; actual manual import is
subject to the merchant's existing Matrixify installation and plan limits.

## Verification

`node scripts/test-matrixify-workflow.mjs`:

- Uses a temporary Unix-socket-only PostgreSQL cluster, clean environment with no
  application credentials and the exact installed SQL fingerprint.
- Tests audited approval/revoke, revision and same-supplier conflicts, cost-change
  rejection, audit-failure rollback, unchanged supplier quantities and no hold
  resolution writes.
- Tests all 209 source holds before SQL, planner regression cases, all four supplier
  calculations, stale/unknown/lower-bound quantities, duplicate/missing SKUs,
  draft/archive exclusion, private-metafield/price gates, owner/digest/expiry/source
  binding, workbook round trips, long IDs and formula-like strings.
- Parses a synthetic 42,308-row baseline. This is not the real uploaded catalog.
- Blocks `fetch`; no application database or Shopify connection is used.

The temporary cluster is stopped and removed after the run.
Actual Clerk sign-in and actual store-import behavior require separately configured
resources and are not established by synthetic/mock tests.

## Documentation used

- https://matrixify.app/documentation/products/
- https://matrixify.app/documentation/metafields/
- https://matrixify.app/documentation/list-of-commands-across-matrixify-sheets/
- https://matrixify.app/tutorials/minimum-columns-to-update-product/
- https://shopify.dev/docs/api/admin-graphql/2026-07/enums/MetafieldAdminAccess
