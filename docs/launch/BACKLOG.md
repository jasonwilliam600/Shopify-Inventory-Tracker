# Top Speed Hobbies delivery backlog

Source: owner's Final Development Directive. This is delivery sequencing in the
existing application, not permission to execute live operations.

## Phase 1 — current priority: operational Matrixify workflow

1. Configure development owner/reviewer sign-in. Identify the owner's verified
   account and explicitly allowlist that subject; never authorize the first signup.
   Production identities and grants are separate.
2. Complete independent catalog identity reconciliation and independent encrypted
   archive backup/restore verification. Original export evidence collection is
   closed. Do not fabricate receipts, historical dates or identity observations.
3. Present the exact guarded real catalog import, backup/recovery and verification
   for separate approval. Do not execute it on the authority of this backlog.
4. Obtain a fresh full Matrixify Products baseline; configure the verified existing
   inventory location, approved safety policy and authenticated exact SKU mappings.
5. Present merchant-owned metafield definitions and access/privacy implications
   for explicit approval. Existing app-owned definitions remain unchanged.
6. Prepare a controlled **10 distinct products** (not arbitrarily 10 variants) test:
   enumerate every included variant, mapping, supplier contribution, quantity,
   price proposal and exact inventory location. Preserve inventory, supplier
   metadata and pricing as **three separate** previewed/expiring XLSX exports.
   Pricing changes and each real import require separate explicit approval.
7. Independently verify actual import results, exceptions and untouched records
   before seeking approval for full-catalog exports.

Detailed owner steps: ../matrixify/PHASE1-OPERATOR-STEPS.md.

## Phase 2 — scalable suppliers (after Phase 1)

- Arbitrary active supplier count, added by integration/configuration rather than
  supplier-count-specific planner, mapping, pricing or reporting redesigns.
- COMBINE all active, eligible, correctly matched supplier quantities; apply
  approved buffers/caps once. Choose the lowest verified eligible per-piece cost.
- Preserve original supplier SKUs, separate quantities/costs/statuses/update times,
  individual-piece/package distinctions, collision protections and all 209 holds,
  including 12 terminal rejections. Keep existing adapters/schedules working.
- Extend mapping, reporting, availability history and structured Shopify variant
  metafields dynamically. Practical Admin presentation must not depend on four
  hardcoded supplier summary fields.
- Supplier identity discrepancy to resolve before this phase: owner's directive
  lists Heartland, HobbyTyme, **Emery Distributors**, Squadron/MMD; installed
  adapters currently include **Walthers**. Do not treat those names as aliases,
  rename an integration, add one or remove one without owner confirmation.

## Phase 3 — 180-day Out-of-Stock Monitoring (after Phase 1)

- Variant history based only on verified combined supplier availability across
  all active eligible associated suppliers. Flag for manual review after
  **180 consecutive verified-zero days**; track last verified in-stock date.
- Missing, stale, failed or unknown feeds are never zero. No assumed/backdated
  history. Reset on verified positive stock. Model supplier/mapping membership
  changes explicitly so they cannot falsely extend a continuous stockout.
- Track physically owned Top Speed Hobbies stock separately.
- Preserve historical evidence and review/dismissal notes, including after review.
  Never automatically archive/delete/unpublish or otherwise modify Shopify.
- **Mandatory main dashboard section:** actual verified totals unavailable,
  30+/60+/90+/180+ days, awaiting review and incomplete/unverified history.
  The 180+ count is conspicuous and clickable. Preview product name, Shopify SKU,
  verified days unavailable, last verified in-stock date, supplier availability
  and review status. Include **View All** to the dedicated watchlist.
- Watchlist: search product/SKU/manufacturer/supplier; filters 30/60/90/180+ days;
  longest-unavailable sorting; individual supplier availability history; Shopify
  product links; authenticated review/dismissal and reviewer notes.
- Historical record/coverage design and any migration require review before
  implementation/execution. Do not substitute current feed timestamps for history.

## Phase 4 — permanent authorized Shopify automation

Matrixify is a **temporary workaround**, not the final publishing architecture.
Preserve and reuse the existing planner, mapping/audit and safety contracts.

- Investigate only supported, policy-permitted connection/deployment paths.
  Do not bypass platform restrictions or expose credentials.
- Existing automatic supplier refreshes; dynamic combined inventory; approved
  automatic pricing; individual supplier visibility; approved mapping management;
  scheduled Shopify inventory and pricing synchronization.
- Durable audit/error/reconciliation/recovery safeguards, bounded safe retries,
  prevention of destructive bulk changes and future supplier expansion.
- No direct publishing or automatic Shopify synchronization activation without
  separate approval of the exact proposed operation.

## Standing authorization boundaries

No unrelated features, replacements, paid services or unnecessary infrastructure.
No real catalog import, production migration/database change, Shopify write,
metafield creation/access change or automatic synchronization without the owner's
explicit operation-specific approval. Later phases are recorded, not activated.
