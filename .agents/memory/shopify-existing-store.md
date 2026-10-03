---
name: Existing Shopify store connection
description: Distinguish development-store provisioning from connecting the merchant's existing store.
---

The user wants Inventory Tracker connected to their existing Shopify store, not a newly provisioned store.

**Why:** The Shopify Store provisioning integration created a new development store and returned a claim link, which does not connect the user's existing catalog.

**How to apply:** Verify the integration's purpose and connected shop identity before importing data. The catalog also exposes a Shopify connector described as authenticated Admin API access; inspect its setup and capabilities for existing-store access. Do not treat a claim link as existing-store authorization.

Do not repeatedly guide the user through Integrations, Sign in, and Manage without a verified route to repair the existing-store connector configuration.

**Why:** The user said, "You have me going in circles. I sent same screenshot before." The existing-store sign-in dialog exposed only a subdomain, while Shopify rejected the OAuth request because the app identifier was an email address. The new-store Manage entry did not establish a repair route for the separate existing-store connector.

**How to apply:** Distinguish an invalid OAuth app configuration from the merchant's login or store domain. If configuration editing is not available through documented tools or visible UI, report that blocker instead of repeating authorization or inventing a settings path. Never persist the email or credential values.

Replit Support clarified that a subdomain-only authorization dialog is expected for Core users: the existing-store Shopify connector uses Replit's registered OAuth app. Custom Client ID/secret configuration is Enterprise-only.

**Why:** The earlier authorization error does not mean the merchant needs to supply OAuth credentials or that the subdomain-only dialog is defective. Official connector documentation also distinguishes Enterprise custom OAuth clients.

**How to apply:** Use the authenticated Admin API `shopify` connector for the existing store, not the new-store provisioning integration. Follow Support's instruction to try a fresh authorization with just the shop subdomain. If it fails again, capture the exact error rather than claiming the underlying OAuth configuration was repaired or repeating the same flow.

After the fresh authorization still produced `application_cannot_be_found` with an email address passed as Shopify's `api_key`, Replit Support explicitly confirmed that this is a backend issue on their end, not something the merchant can fix from their side.

**Why:** Reauthorization did not resolve the invalid app identifier. Support's confirmation establishes that the connector configuration, not the inventory app or merchant's store login, requires repair.

**How to apply:** Do not propose another identical authorization attempt, change store/account settings, or ask for merchant credentials. Wait for confirmation of a connector repair before retrying; do not claim it is fixed until authorization succeeds and the existing shop's identity is verified.

Do not identify the email-shaped `api_key` in the OAuth error as the merchant's Shopify account or store email.

**Why:** The user explicitly corrected that attribution: the displayed address is not attached to the store. Its origin has not been established.

**How to apply:** Describe it only as the invalid app-identifier value shown in the error. Do not infer account ownership or request a different email as a replacement Shopify app API key.