---
name: Store dashboard metrics
description: Store SKU totals must come from Shopify rather than the supplier or retained import catalog.
---

The dashboard's Total SKUs metric must be the user's store SKU total. Supplier-catalog and historical tracker totals are not substitutes.

**Why:** The user stated, "Thats irrelevent infpormation for my store. It should be my stores total SKUs" when shown the accumulated tracker count.

**How to apply:** Use verified store-catalog data for the main SKU metric. While Shopify data is unavailable, show an unavailable or awaiting-connection state, not supplier totals, a fabricated count, or zero. Keep any separately useful supplier metrics clearly labeled and distinct from the store catalog.