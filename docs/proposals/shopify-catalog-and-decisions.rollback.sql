-- REVIEW ONLY. NOT EXECUTED. DEVELOPMENT DATABASE ONLY.
-- Requires a SEPARATE explicit rollback approval after the forward migration.
-- First restore the historical read path and retain the code-level exclusions.
-- If imported catalog/review data exists, securely back up THESE TWO TABLES
-- before dropping them. This rollback deletes only their newly stored data.
-- No CASCADE: unexpected external dependencies must cause a safe failure.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DROP TABLE public.supplier_mapping_decisions RESTRICT;
DROP TABLE public.shopify_variant_catalog RESTRICT;
COMMIT;
