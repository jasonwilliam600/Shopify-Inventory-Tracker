---
name: OpenAPI generation collision
description: Why preview pagination uses query-only parameters and generated exports must not be patched manually.
---
The installed Orval generation has produced duplicate Zod parameter exports for
an operation containing both path parameters and pagination query parameters.

**Why:** Regenerating a mixed-parameter preview endpoint reproduced the duplicate
export; a manual generated-file rename only hid it until the next generation.

**How to apply:** When this error appears, inspect the source contract and
generator configuration. A query-only preview-read endpoint resolved the collision
without losing pagination. Do not manually rename exports in generated files.
