---
name: User supplied SKU prefix mappings
description: Merchant-provided prefix correspondences for supplier and Shopify SKU reconciliation.
---

Use Heartland's official “Lines We Carry” directory for Heartland manufacturer display, independently of the HobbyTyme directory.

**Why:** The user supplied that directory for Heartland mapping. It repeats some codes across several product lines; a prefix alone cannot identify a single division in those cases.

**How to apply:** Preserve source labels, show the listed alternatives for shared codes instead of guessing a division, and keep unlisted codes explicitly unmapped. Heartland part numbers may start with letters; prefer the longest documented code when prefixes overlap.

The user provided these prefix pairs:

```text
WOO:WDS
ACD:ACY
DTX:DIG
EVE:EVG
HEL:HLR
KDE:KAD
KAL:400
KIN:KTY
LIN:LND
MBL:MTB
MIC:MSI
SAL:SJM
STX:TSU
BWL:BLI
RVP:RMX
```

The original list repeated WOO:WDS. The user clarified, "those are the prefixes." Treat the pairs as supplier-to-store prefix correspondences, not complete SKU replacements. The user explicitly requires automatic conversion and gave the example supplier `ACD/12551` → existing store `ACY-12551`.

**Why:** These are merchant-supplied identifier conventions, not universal manufacturer rules. Keep numeric-looking prefixes such as 400 as text.

**How to apply:** Use the store's hyphen between the mapped prefix and untouched part number. Retain original supplier identifiers and leading zeros, detect collisions, and allow verified item-level exceptions rather than renaming Shopify SKUs or matching numeric suffixes alone. Manufacturer labels alone do not satisfy this reconciliation requirement; mapped store SKUs must be visible and searchable.

Manufacturer display must use the merchant-supplied manufacturer's directory labels, including separate product divisions, rather than generic brand grouping or names inferred from the correspondence pairs above.

**Why:** The supplied directory distinguishes paint/supply divisions, model-kit lines, and regional divisions within the same brand; a correspondence between supplier and store prefixes does not make their manufacturer labels interchangeable.

**How to apply:** Preserve the directory's labels verbatim, including prefixes containing `+`. Keep manufacturer display separate from cross-store SKU reconciliation; do not synthesize manufacturer aliases from correspondence pairs.

Avoid a large regular-expression alternation for every catalog row when implementing mapped-SKU search.

**Why:** Testing against the full supplier catalog showed that regex-based prefix extraction substantially increased search latency. Simple prefix string comparisons with a small part-number validation were faster.

**How to apply:** Keep search normalization consistent with displayed conversions, but use bounded string operations for documented fixed-width codes. If mapping codes gain different widths, explicitly adapt and measure the SQL normalization rather than silently truncating them.