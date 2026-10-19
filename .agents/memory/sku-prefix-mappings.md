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

**How to apply:** Use the store's hyphen between the mapped prefix and untouched part number unless the merchant confirms a brand-specific exception (Eduard has no prefix hyphen). Retain original supplier identifiers and leading zeros, detect collisions, and allow verified item-level exceptions rather than renaming Shopify SKUs or matching numeric suffixes alone. Manufacturer labels alone do not satisfy this reconciliation requirement; mapped store SKUs must be visible and searchable.

Manufacturer display must use the merchant-supplied manufacturer's directory labels, including separate product divisions, rather than generic brand grouping or names inferred from the correspondence pairs above.

**Why:** The supplied directory distinguishes paint/supply divisions, model-kit lines, and regional divisions within the same brand; a correspondence between supplier and store prefixes does not make their manufacturer labels interchangeable.

**How to apply:** Preserve the directory's labels verbatim, including prefixes containing `+`. Keep manufacturer display separate from cross-store SKU reconciliation; do not synthesize manufacturer aliases from correspondence pairs.

Avoid a large regular-expression alternation for every catalog row when implementing mapped-SKU search.

**Why:** Testing against the full supplier catalog showed that regex-based prefix extraction substantially increased search latency. Simple prefix string comparisons with a small part-number validation were faster.

**How to apply:** Keep search normalization consistent with displayed conversions, but use bounded string operations for documented fixed-width codes. If mapping codes gain different widths, explicitly adapt and measure the SQL normalization rather than silently truncating them.

For MMD/Squadron, the merchant confirmed unchanged prefixes: AAM for A&A Models, TAM for Tamiya, TRP for Trumpeter, and SCL for Squadron Colors. They said they do not currently carry A&A Models or Squadron Colors, but want to keep AAM and SCL for those brands.

**Why:** These are explicit merchant choices, including naming conventions for brands not currently in the store; they are not inferred mappings or evidence of existing store products.

**How to apply:** Use these correspondences when preparing MMD SKU rules. Preserve the store's hyphen convention and full part numbers. Do not create store products, infer catalog membership, or extend approval to other MMD prefixes.

The merchant also double-checked and explicitly confirmed MMD's Master Box prefix correspondence **MBL → MTB**.

**Why:** The merchant said, "Yes thats correct. i double checked" in response to the Master Box mapping explanation.

**How to apply:** Enable this correspondence for MMD using the same hyphen and unchanged part number, including leading zeros.

The merchant subsequently confirmed the proposed MMD Academy **ACD → ACY** and Evergreen **EVG → EVG** correspondences.

**Why:** The merchant replied, "Those are correct" during the review of the remaining proposed rules.

**How to apply:** Use these correspondences for MMD with the store's hyphen format and untouched part numbers. They are approved identifier conventions, not verified Shopify catalog matches.

The merchant confirmed **EDU → EDU** for Eduard and clarified: "Actually Eduard SKUs dont have hypens in my store. I can add them if needed."

**Why:** Existing store identifiers are the source of truth; there is no need to rename them to fit supplier mapping.

**How to apply:** Format MMD EDU identifiers without a separator between the prefix and part number, such as EDU00001. Preserve the complete part number, internal punctuation, and leading zeros. Keep JavaScript display and SQL matching consistent, leave other brands' approved formats unchanged, and keep candidates unverified until actual store identifiers are compared.

The merchant authorized the next three CSV-supported MMD rules by replying, "Whatever will work best for the sync": MiniArt **MIN → MIA without a hyphen**, Hobby Boss **HBB → HBB with a hyphen**, and ICM **ICM → ICM with a hyphen**.

**Why:** These were the three specific rules presented for approval, supported by the existing store export; adapting supplier identifiers avoids renaming store SKUs.

**How to apply:** Enable these rules only for MMD, preserving full part numbers and leading zeros. This approval does not authorize stock publishing, pack/price conversion, resolving duplicate store SKUs automatically, or applying the other unreviewed suggestions.

The merchant explicitly confirmed Walthers manufacturer code **785 = Woodland Scenics**: "785 = Woodland scenics for sure."

**Why:** The merchant confirmed the brand identity, and the store CSV supports the no-hyphen correspondence `785-105` → `WDS105`; this is specific to Walthers, not a global Woodland Scenics format change.

**How to apply:** Use Walthers **785 → WDS without a prefix hyphen**, retaining the complete part number, alphabetic series, and leading zeros. Require the Walthers code/part hyphen in source identifiers. Leave other suppliers' existing Woodland Scenics rules unchanged. Brand confirmation alone does not verify selling units, duplicate variant assignment, or authorize Shopify publishing.

The merchant approved the full uploaded-export comparison: "All the mapping suggestions look good."

**Why:** This authorizes all identifier suggestions in that comparison, including item-specific store formats, but is not confirmation of selling units, wholesale pack pricing, or live Shopify variant identities.

**How to apply:** Treat those suggestions as supplier-scoped exact item candidates. Prefer the exported identifier over a generic prefix rule; do not extrapolate competing TAK/TAO, RYE/RFM, or other alternate formats to unseen items. Retain product/units review flags and keep publishing disabled until live Shopify verification is possible. A new comparison needs its own review rather than inheriting approval automatically.

Store-format exceptions include case differences inside the part number, not only in the manufacturer prefix.

**Why:** The approved export includes supplier `MENDS4s` versus store `MGM-DS4S`. Rejecting all suffix case differences would discard an approved pair; forcing one source casing would fail to reproduce the existing store SKU.

**How to apply:** When validating approved evidence, compare the complete retained alphanumeric part without case sensitivity, then use the exact exported store identifier as the candidate. Never reduce identifiers to a numeric suffix.

The owner's Mapping Center workflow is manufacturer-prefix rules first, with
individual SKU corrections as the fallback, exclusively for Top Speed Hobbies.
Supplier choices must expand dynamically, not be permanently limited to four.

**Why:** The owner explicitly approved this workflow and design, while requiring
historical comparisons to remain unverified and existing exceptions and holds
to take precedence.

**How to apply:** Keep new proposals separate from active configuration and
verified product relationships. Prefix or title agreement alone is not product
identity evidence; a rejected-product proposal must not silently reopen its hold.