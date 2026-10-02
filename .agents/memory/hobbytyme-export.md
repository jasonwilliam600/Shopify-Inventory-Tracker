---
name: HobbyTyme export behavior
description: Non-obvious constraints of the HobbyTyme inventory export that affect reliable refreshes.
---

Treat the HobbyTyme inventory page as a Basic-authenticated index of timestamped CSV files, select the newest listed file, and normalize the feed before a bulk upsert. Deduplicate by Part Number and account for duplicate source rows explicitly. Stock values may be bounded text such as `10+`, so parse the numeric portion rather than requiring a plain integer.

**Why:** A raw bulk upsert failed because a single export contained repeated Part Numbers, and PostgreSQL cannot update the same conflict target twice in one insert statement.

**How to apply:** Any future HobbyTyme importer or reconciliation change must preserve source-row totals, deduplicate before batching, retain the original row fields, and keep credentials in project Secrets.