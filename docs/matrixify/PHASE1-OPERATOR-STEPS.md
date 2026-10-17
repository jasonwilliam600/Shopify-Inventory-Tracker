# Phase 1: owner steps and approval boundaries

## 1. Sign in and authorize the owner

Open the running development preview → **Matrixify Review** → **Sign in**.
If you do not yet have an app account, choose **Sign up**, use your own email or
available provider, and finish its verification. Enter passwords/verification
codes only into the sign-in UI, never into chat. Creating an account alone does
not authorize mapping approvals or confidential exports.

Tell the project owner/Agent which primary email you used. A read-only development
lookup resolves only that explicitly identified account after its primary email
is verified and confirms the account is neither banned nor locked. The lookup
does not create users or grant permissions:

`node scripts/resolve-owner-reviewer.mjs`

It requires owner-configured non-secret `MAPPING_OWNER_EMAIL`. Clerk credentials
come from managed configuration and are never printed. It refuses production
keys. The verified subject then needs an explicit development allowlist update
through environment configuration (`MAPPING_REVIEWER_SUBJECTS`), preserving any
already authorized subjects. Never store email/passwords/tokens in source.
Production users/authorization are separate; this does not publish anything.

## 2. Existing catalog and private archive prerequisites

Reuse the validated 42,308-variant JSONL and recovered original provenance.
Do not recollect original operation metadata. Before the real import, the
unchanged contract still requires an independent complete identity reconciliation,
a protected encrypted archive and independent backup/restore evidence.

A synthetic Windows rehearsal is not proof that a real encrypted backup reached
the owner's computer. A proposed real archive operation must list its content,
private destination, encryption/recovery-key handling and integrity expectations.
The owner must independently verify the download and restore; never claim to
have inspected the owner's Windows filesystem remotely without doing so.

No existing contract is weakened. No real import is implied by this document.

## 3. Exact real-import approval package

Before executing anything, present the **actual** values for:

- Development target identity; exact source file bytes/SHA-256; completed archive
  manifest/receipt and independent identity-reconciliation evidence.
- Parser-validated unique variant count and active/draft/archived status counts.
- Missing/duplicate SKU counts; preserve all variants while flagging unsafe SKUs.
- Existing catalog/mapping/audit/hold state and collision protections.
- Development backup plus isolated restore evidence, transaction guards and
  expected insert/update/deactivation scope. Supplier tables are not import targets.
- Fail/uncertain-commit handling, guarded recovery and post-import verification.

Missing values remain explicit blockers, not invented placeholders in an approval.
No supplier stock, cost, mapping decision, audit evidence or source hold is reset.

## 4. Obtain a fresh Matrixify baseline

After import prerequisites are satisfied, in your **existing store's installed
Matrixify app** create a **Products** export, using **CSV**:

1. Include every variant and every product status, including draft/archived.
   Do not filter to in-stock items or only the eventual test products.
2. Select product basic fields, variant fields and inventory-level fields. Avoid
   image/additional-image rows; the file must contain one row per variant.
3. Required columns:
   - `ID`, `Variant ID`, `Variant SKU`, `Variant Price`
   - `Variant Inventory Tracker`, `Title`, `Vendor`, `Status`
   - `Option1 Name`, `Option1 Value`
   - `Option2 Name`/`Option2 Value`, `Option3 Name`/`Option3 Value` when used
   - `Inventory Available: <exact existing location name>`
   - `Inventory Committed: <the same exact existing location name>`
4. Keep location-name spelling and exported IDs/SKUs unchanged. Include the
   intended existing supplier-publishing location, not a guessed/default location.
   If a required field is unavailable in your export settings, stop and report
   the missing column rather than substituting zero or renaming another field.
5. Download the completed CSV. Record when the inventory/prices were actually
   observed/exported. Do not use Windows file modification time as proof.
6. In **Matrixify Review**, select this file, enter its observation time and
   confirm the baseline. Parser validates full coverage and identities.

This is a fresh operational price/inventory/commitment baseline, not a request to
replace the original catalog evidence or another automatic catalog import.

## 5. Configure policy, mappings and supplier metadata

Use READINESS.md and config.example.json. Do not guess inventory location IDs,
policy values, final pricing formulas or permission observations. Select the
existing verified location, keep physically owned stock separate, approve only
specific identity/unit-verified source relationships and preserve every source hold.

Merchant-owned metadata proposal (all owner type `PRODUCTVARIANT`):

| Namespace | Key | Type |
| --- | --- | --- |
| `tsh_inventory_sync` | `supplier_availability` | `json` |
| `tsh_inventory_sync` | `heartland` | `multi_line_text_field` |
| `tsh_inventory_sync` | `hobbytyme` | `multi_line_text_field` |
| `tsh_inventory_sync` | `walthers` | `multi_line_text_field` |
| `tsh_inventory_sync` | `mmd_squadron` | `multi_line_text_field` |

The structured record preserves each supplier separately. Current four readable
summaries preserve compatibility; Phase 2 will make supplier presentation dynamic,
not rename Walthers as Emery.

These merchant-owned fields have Admin `PUBLIC_READ_WRITE`: other Admin apps can
read/write them. Storefront and customer-account API access must be `NONE`.
That alone does not prove themes cannot expose costs. Owner access-model approval,
theme/privacy review and verified actual definition evidence are mandatory.
Existing `$app:tsh_inventory_sync` definitions remain unchanged. Nothing here
creates definitions, pins fields or changes Shopify permissions.

## 6. Controlled ten-product test and actual results

Select **10 distinct existing product IDs** after current identities, mappings,
baseline and policy are verified. Enumerate every included variant, all supplier
contributions, exclusions, quantities, original/current/new values and location.
Do not invent the real test cohort before current data is available.

Preview and inspect the exception report first. Download separately:

1. Inventory-only workbook.
2. Supplier-metafield workbook, only after definition/privacy approval.
3. Price-only workbook, only after separate exact pricing approval.

An export is not permission to import. Each live test requires approval of the
exact workbook/profile/IDs/row counts/values/location. Review Matrixify's analysis;
abort on create/delete, wrong location or unexpected scope. Confirm the location
still exists unchanged. Do not reuse expired files or automatically retry.

Verify actual per-variant quantities/prices/metafields, original source units,
import outcomes, exceptions and a sample of untouched variants after each step.
Keep the evidence; investigate partial results before a new corrective plan.
Manual imports cannot guarantee API compare-and-set/atomicity while orders change.
Full-catalog exports/imports remain gated on actual controlled-test results and
separate approval. Automatic Shopify synchronization remains disabled.
