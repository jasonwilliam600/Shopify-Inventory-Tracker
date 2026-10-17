---
name: Managed catalog archive storage boundaries
description: Owner-selected archive bucket name, managed object-versus-bucket permissions, and real SDK compatibility checks.
---

The owner selected the App Storage display name
`top-speed-shopify-catalog-archive`. Do not confuse a display name with the
underlying opaque bucket ID; inspect the current project/runtime binding.

**Why:** The owner created this bucket for the private Shopify catalog archive.

**How to apply:** Confirm the display-name/ID association before binding the
archive; do not hardcode a friendly name as a GCS bucket identity.

Managed storage credentials can allow object reads, creation, updates and deletion
while denying bucket metadata and IAM-policy reads. Successful managed
authentication does not prove the archive's private-policy checks can execute.

**Why:** Read-only inspection found effective object access but HTTP 403 for
bucket metadata and IAM policy. The archive's required privacy verification
therefore could not run with the development runtime identity.

**How to apply:** Check effective permissions and obtain a supported metadata
verification path before activation. Do not substitute private-by-default
documentation for actual policy verification or silently bypass the fail-closed
check. Retention and administrator-level immutability remain separate concerns.

SDK-shaped mocks do not prove real SDK structural type compatibility. Validate
and narrow real metadata at the boundary rather than casting a whole client to
the archive's interface.

**Why:** The real storage SDK allows non-string custom metadata values, whereas
the archive's internal metadata interface accepts strings; a direct binding
failed an inspection-only TypeScript check under the application's compiler
settings.

**How to apply:** Review a narrow typed SDK wrapper before connecting the archive.
Keep checksum, generation and privacy validation intact; do not silence the
mismatch with an unchecked cast.
