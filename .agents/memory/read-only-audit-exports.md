---
name: Read-only audit export limits
description: SQL output truncation and notebook memory limits when producing inventory audit reports.
---

Do not treat a successful SQL response as proof that its CSV output is complete. Use bounded pages, stable ordering, and independent row-count checks before deriving inventory safety conclusions.

**Why:** An inventory audit query succeeded but its CSV was truncated at approximately 1 MiB, leaving a partial final record. Smaller pages recovered the complete data.

**How to apply:** Check truncation markers and CSV field widths, reconcile exported counts, and exclude partial exports from deliverables. Prefer a consistent read snapshot or document observation times when background refreshes continue.

Keep large raw query responses scoped narrowly and release them after saving report data.

**Why:** Retaining payloads across notebook calls exceeded its 32 MiB memory limit and reset all notebook variables, including earlier approved manifests.

**How to apply:** Persist necessary audit inputs in an ignored report directory, keep only small summaries in notebook state, and never assume previous variables survive a reset. Run catalog-scale per-record joins in a shell/Python process: retaining per-source objects and Maps can exceed the limit even when the serialized input is small.
