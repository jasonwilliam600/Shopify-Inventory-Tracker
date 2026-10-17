# TSH Inventory Sync — implementation checkpoint

Current delivery order and deferred phases: [BACKLOG.md](BACKLOG.md).
Matrixify launch prerequisites and owner steps:
[Phase 1 operator steps](../matrixify/PHASE1-OPERATOR-STEPS.md).
Matrixify is temporary; authorized permanent automation remains the final goal.

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
- The established rule is COMBINE all four eligible suppliers. Proposed available inventory is
  `min(approvedCap, max(0, SUM(eligibleSupplierPieces) - approvedSafetyBuffer - ShopifyLocationCommitted))`.
  The existing safety buffer/cap inputs remain in place and are applied once to
  the combined quantity, never once per supplier. Single-supplier selection is
  no longer an accepted policy. Each record must have a unique approved
  relationship; duplicate rows/aliases cannot inflate the sum.
  Unknown commitments, stale/unknown quantities and upper bounds block
  publishing. Lower bounds require an explicit floor policy. Physical-store
  stock is not manufactured or added. HobbyTyme On Hand remains pieces.
- Pricing basis is the LOWEST verified, fresh, eligible cost per individual
  piece among in-stock suppliers. Out-of-stock/stale/held/unverified offers do
  not set the minimum. Pack costs are divided by verified pack sizes using exact
  rational arithmetic; final prices are rounded only after the approved formula.
  This never converts HobbyTyme stock into packs. MSRP is not a cost.
  Final selling-price formula/percentage still requires owner approval.
- Five app-owned PRODUCTVARIANT metafields are prepared: one structured JSON
  record plus four individually readable supplier summaries. Each keeps supplier
  name, original supplier SKU, quantity/bound/status, mapping status, verified
  cost, pricing eligibility and last successful inventory timestamp separate.
  No source SKU, quantity or cost is presented as trusted for a held relationship.
  Freshness and out-of-stock/unknown distinctions survive the metafield payload.
  Four summaries can be pinned in Shopify Admin's variant metafield section
  where supported. No extension/new service is needed for this built-in view.
  App-owned definitions require merchant-read-only Admin access and NONE on the
  Storefront and Customer Account APIs. Their actual access must be verified.
  Metafield writes use per-key compareDigest; missing baselines block the write.
- Execution requires a trusted reviewer-authorized exact plan, whole-plan and
  per-operation fresh preconditions, durable intent, inventory compare-and-set,
  and readback. Only read failures retry (bounded). Ambiguous writes stop the
  worker and retain a durable lease. Transport implementations must actually
  implement these contracts; a mock pass is not Shopify live verification.
  Every aggregate operation carries all contributing mapping/source revisions,
  and a fingerprint covering the full relationship set. A change to ANY
  contributor invalidates preflight; minimum-cost pricing is not verified using
  only the cheapest supplier's old row.
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
7. Shopify metafield definitions, pins and variant values are PREPARED ONLY:
   none have been installed/written. `supplier-variant-metafields.ts` contains
   the definition, pin, baseline query and atomic write payloads. Their live
   configuration and publication each require an exact approved operation.
   The existing working Shopify connection is unchanged.

## Required operating decisions before a launch proposal

- COMBINE eligibility and the approved safety buffer/cap are established
  requirements, not decisions to reopen. Remaining unconfigured freshness,
  lower-bound or destructive-change controls must not invent approved values.
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
   Separately present the five exact metafield definitions and four requested
   pins for approval. Read/verify existing definitions first; stop on conflicts,
   public access or pin limits rather than changing unrelated configuration.
   Resolve the canonical namespace for the actual existing app installation.
   Variant metafield writes require write_products and the owner's explicit
   approval; this does not authorize product/price/inventory edits implicitly.
6. Produce a current dry run with per-variant before/after values and holds.
7. Obtain explicit approval of a small exact controlled-write plan. Compare
   quantities, record intent, apply once, read back. Never blindly roll back or
   retry an unknown Shopify outcome; inspect and separately approve recovery.
8. Obtain explicit approval of the exact recurring activation scope and limits.
   Enable only after the controlled test and end-to-end integration pass.

No real catalog import, production DB modification, Shopify write or automatic
activation has been performed by this implementation work.
