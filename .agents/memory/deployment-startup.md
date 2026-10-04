---
name: Deployment startup and database readiness
description: Keep HTTP startup independent of database backfills while reporting inventory readiness honestly.
---

Do not wait for database compatibility backfills or supplier imports before opening the HTTP listener. Keep inventory readiness separate from HTTP liveness, with explicit temporary-unavailability responses and bounded, non-overlapping retries.

**Why:** A production publish compiled successfully but failed promotion because database initialization prevented the API from opening its port before the artifact runtime's 60-second startup deadline. The earlier build remained live.

**How to apply:** When changing startup behavior, verify the production process can answer its startup health probe even with an unavailable database, and verify inventory endpoints do not return misleading successful responses while initialization is pending. Keep backfills idempotent and database timeouts bounded; do not widen the startup timeout to hide blocking database work.