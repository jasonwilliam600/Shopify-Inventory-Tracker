---
name: Permanent mapping data requirements
description: Owner requirements for permanent business persistence and missing-history recovery.
---

TSH Inventory Sync is a permanent internal inventory management system for Top
Speed Hobbies. Development-only proposal files are not acceptable long-term
business storage. Reuse existing PostgreSQL infrastructure rather than creating
another database unnecessarily.

**Why:** The owner explicitly prioritized permanent, recoverable business data,
including proposal revisions, deletions, rule lifecycle and original protection
evidence.

**How to apply:** Inventory original sources, verify independent backup and
restoration, and present exact additive SQL and rollback before migration.
Preserve record IDs, reviewer evidence and all source holds. Deletion must remain
auditable and recoverable. Configuration persistence does not authorize mapping
activation or Shopify publishing.

Never infer an empty proposal history from an inaccessible or missing journal,
and never initialize an empty replacement as a recovery shortcut.

**Why:** The owner explicitly required locating the original journal and reporting
unrecoverable history honestly rather than silently replacing it.

**How to apply:** Require source recovery or an explicit owner decision acknowledging
the historical gap before prospective cutover. Keep original evidence unchanged,
prevent lost writes, and distinguish development from production data transfer.
