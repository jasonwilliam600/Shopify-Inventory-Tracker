---
name: Supplier visibility approval boundaries
description: Merchant acceptance of historical visibility and explicit SQL approval requirements for catalog/review storage.
---

The merchant accepted clearly labeled historical-catalog supplier visibility as
an interim result, not current Shopify variant verification.

**Why:** They explicitly accepted the read-only dashboard implementation even
though current Shopify variant IDs and product/selling-unit approvals remained
blocked prerequisites.

**How to apply:** Preserve the distinction between historical candidate
relationships and verified current variants when replacing the catalog reader.
Acceptance of the preview does not approve matches, inventory writes or publishing.

For Shopify catalog and mapping-decision storage, approval of the table design
does not authorize executing a migration.

**Why:** The merchant separately required final SQL approval after approving the
two-table design, repeating the execution boundary.

**How to apply:** Present exact SQL with keys/indexes, preservation of existing
holds, duplicate-SKU handling, rollback and supplier-data impact. Wait for explicit
approval of the final SQL before any schema execution. Keep this additive
migration's write set outside existing supplier tables and records.

Held source relationships must be correctable through explicit individual
review, without deleting the original rejection/flag evidence or clearing
unrelated holds.

**Why:** The merchant approved a Fix Mapping / Resolve & Approve workflow, not
permanently unresolvable exclusions or broad prefix-based clearance.

**How to apply:** Preserve default source holds. Future verified, source-specific
approvals may supersede only the explicitly reviewed hold/cause, with reviewer
identity and audit evidence retained. Other, new or changed holds still block.
An old exact-item null must not veto a separately authorized permanent decision
after its applicable holds have been resolved.

Authorization to install reviewed mapping storage does not authorize live catalog
imports, permanent approval APIs, reviewer-authentication changes, or activation
of Save/Approve.

Approval of importer implementation and disposable PostgreSQL tests likewise does
not authorize running the importer against the actual development database.

**Why:** The merchant explicitly separated schema installation from those later
capabilities, required approval controls to remain disabled, and separately limited
importer implementation approval to code and isolated tests.

**How to apply:** Keep each capability behind its own approval and verified
prerequisites; database object existence alone must never unlock mapping actions.
