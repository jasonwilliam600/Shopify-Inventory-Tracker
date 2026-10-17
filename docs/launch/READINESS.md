# TSH Inventory Sync — implementation checkpoint

## Implemented and isolated-tested

The existing API constructs an inert synchronization application service. It
does not initialize a private archive, create keys, access Shopify, import a
catalog, install SQL, or start a publishing timer.

- Catalog lifecycle can open the existing development filesystem backend after
  explicit initialization, stage an explicitly approved genuine import plan,
  require protected backup readiness, and execute the existing transactional
  importer. It requires fresh development-database backup/restore evidence and
  records prepared/committed/uncertain outcomes. No retry after uncertain commit.
- Planner supports all four suppliers. It requires approved, identity-bound,
  unit-verified mappings; rechecks all 209 source holds before source lookup;
  blocks ambiguous same-supplier aliases and duplicate/missing Shopify SKUs.
- One supplier is selected by an explicit priority or maximum-availability
  policy. Quantities are not summed. Proposed available inventory is
  `min(cap, max(0, selectedSupplierPieces - safetyBuffer - ShopifyLocationCommitted))`.
  Unknown commitments, stale/unknown quantities and upper bounds block
  publishing. Lower bounds require an explicit floor policy. Physical-store
  stock is not manufactured or added. HobbyTyme On Hand remains pieces.
- Prices use integer cents and the selected supplier's independently verified
  cost basis. MSRP, unknown units, unverified packs or stale costs cannot set
  selling prices. Markup and gross-margin formulas are separate. No business
  defaults have been approved or installed.
- Execution requires a trusted reviewer-authorized exact plan, whole-plan and
  per-operation fresh preconditions, durable intent, inventory compare-and-set,
  and readback. Only read failures retry (bounded). Ambiguous writes stop the
  worker and retain a durable lease. Transport implementations must actually
  implement these contracts; a mock pass is not Shopify live verification.
- One inert, serialized schedule driver supports all four suppliers without
  replacing their existing refresh schedules. Activation requires authenticated
  approval of the exact shop/policy/variant allowlist/interval/expiry. Any scope
  drift or execution error stops it; restarts do not silently reactivate it.
- Proposed PostgreSQL journal preserves audit events and cross-process leases.
  Recovery first independently reads current values, then requires a separate
  reviewer approval bound to a fresh, opaque recovery report. Resolving an
  incident releases its lease for replanning, never writes Shopify or deletes
  the original uncertain-run evidence.

## Not completed or enabled

This is not a production launch or a completed live end-to-end integration.

1. Real private archive initialization, independent Windows restore receipt and
   real protected-manifest backup acceptance have not been performed.
2. Independent current full-identity reconciliation is still required by the
   unchanged importer contract. Original export evidence collection remains
   closed; do not request it again.
3. The real catalog has not been imported. Mapping approval UI/API remains
   disabled. Authenticated reviewers, current variant verification, audited
   approval transactions and individually authorized hold resolutions still
   need integration. The new planner conservatively retains every static hold;
   it does not silently recognize a supposed hold override.
4. No live PostgreSQL snapshot/mapping/cost loader, authenticated reviewer
   implementation or live Shopify synchronization transport is configured.
   Existing connection code is unchanged. Neither granted scopes, currency nor
   target location is newly verified.
5. Replit integration discovery currently reports both Shopify connectors
   `not_setup`. Agent instructions require managed-proxy Admin I/O, so the
   existing direct-auth helper cannot be repurposed by Agent into a live write
   transport. This is an Agent execution restriction, not a Node runtime
   prohibition. Do not provision a replacement store.
6. `sync-journal-proposed.sql` is a proposal, NOT an applied migration. Its two
   additive tables need explicit approval before any real execution. Existing
   supplier/catalog/mapping tables are untouched. Pre-use rollback is included;
   once used, retain evidence and roll back application code instead.

## Required operating decisions before a launch proposal

- Inventory selection method and supplier priority, buffer, cap, lower-bound
  behavior, row freshness limits and destructive-change thresholds.
- Pricing formula/percentage and verified selling-unit costs, especially
  HobbyTyme's unresolved NetPrice ordering basis. Unknown costs remain held.
- Existing Shopify location ID and confirmed granted scopes; no new location,
  tracking changes or permission changes are implicitly authorized.
- Trusted reviewer authorization and a permitted live transport for this
  existing shop. No unauthenticated Save/Approve or scheduling endpoints.

## Launch sequence and approval boundaries

1. Finish independent backup/reconciliation; connect actual private archive.
2. Present exact development import plan (database identity, catalog SHA,
   42,308 count, backup/restore evidence and protected manifest) for approval.
3. After approved import, verify all fields, flags and existing holds; finish
   authenticated individual mapping approvals. No wildcard promotions.
4. Review/apply journal SQL only after separate explicit approval.
5. Configure approved inventory/pricing policy and read actual scopes/location.
6. Produce a current dry run with per-variant before/after values and holds.
7. Obtain explicit approval of a small exact controlled-write plan. Compare
   quantities, record intent, apply once, read back. Never blindly roll back or
   retry an unknown Shopify outcome; inspect and separately approve recovery.
8. Obtain explicit approval of the exact recurring activation scope and limits.
   Enable only after the controlled test and end-to-end integration pass.

No real catalog import, production DB modification, Shopify write or automatic
activation has been performed by this implementation work.
