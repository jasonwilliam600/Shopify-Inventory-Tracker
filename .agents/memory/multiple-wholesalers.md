---
name: Independent wholesaler inventory
description: Preserve independent stock and pricing across wholesalers, including overlapping SKUs.
---

Keep wholesalers separate, including stock and wholesale pricing for the same SKU. The user chose Walthers as an additional wholesaler alongside Heartland and HobbyTyme.

**Why:** The user explicitly chose “Keep both wholesalers separate” when connecting Heartland Hobby Wholesale alongside HobbyTyme, rather than restricting Heartland to new SKUs or replacing existing supplier data. They subsequently asked to add Walthers, not replace an existing wholesaler.

**How to apply:** New supplier integrations and imports must retain each wholesaler's offer independently. Never replace another wholesaler's stock or pricing simply because the SKU matches. Supplier identifiers are not verified Shopify matches; any cross-supplier or store mapping needs evidence.

Use the Walthers dealer portal at `https://dealers.walthers.com/` when investigating its wholesale inventory source, rather than assuming the public retail website supplies dealer quantities or pricing.

**Why:** The user supplied this portal as the source for connecting Walthers.

**How to apply:** Verify the inventory export or read-only dealer data interface behind that portal before choosing a feed format, quantity interpretation, or manufacturer mapping.

The user wants combined actual Shopify sellable stock with distributor quantities represented by locations, not just a display-only supplier total. They clarified: "i need it to be total sellable stock with locations for quanity".

**Why:** The merchant needs customers to buy against combined eligible stock while still seeing which distributor holds each quantity.

**How to apply:** Aggregate only verified full variant matches across approved distributor locations. Preserve physical-store quantities at their own locations. Until store identity, variant membership, location eligibility, and reservation handling are verified, label feed totals as proposals rather than published Shopify sellable stock.

The user requested automatic Heartland inventory pulls every 30 minutes.

**Why:** The user explicitly chose "every 30 minutes please" rather than the offered hourly schedule.

**How to apply:** Preserve that Heartland cadence when changing supplier refresh behavior; do not apply it to other wholesalers without a separate request.
