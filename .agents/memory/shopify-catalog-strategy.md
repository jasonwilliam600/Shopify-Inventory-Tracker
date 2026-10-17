---
name: Shopify catalog retrieval strategy
description: Merchant-selected bulk-query strategy and independent approval boundaries for the large catalog.
---

Use Shopify bulk queries as the proposed primary full-catalog strategy; do not
continue pursuing ordinary cursor pagination as the primary retrieval method.

**Why:** The merchant explicitly selected this strategy for a historical catalog
containing over 42,000 variants.

**How to apply:** Keep offline parser/contract development separate from live
authentication, bulk-operation submission, result downloads, imports and
activation. Each live step requires the applicable explicit authorization and a
policy-permitted execution path. Completing offline preparation authorizes none
of those actions and does not establish a freshly measured catalog count.
