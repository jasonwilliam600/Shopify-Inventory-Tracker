-- PROPOSAL ONLY. NOT APPLIED. Requires explicit owner approval.
-- Two additive tables; no supplier/catalog/mapping records or schemas are changed.
-- The partial unique index is a durable per-shop/location lease. Unknown runs
-- intentionally keep it. No automatic expiry or resetting uncertain outcomes.
BEGIN;
CREATE TABLE public.shopify_sync_runs (
  run_id uuid PRIMARY KEY,
  shop_domain text NOT NULL CHECK (shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  location_gid text NOT NULL CHECK (location_gid ~ '^gid://shopify/Location/[1-9][0-9]*$'),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^[a-f0-9]{64}$'),
  plan_document jsonb NOT NULL CHECK (jsonb_typeof(plan_document)='object'),
  approved_by text NOT NULL CHECK (length(trim(approved_by))>0),
  operation_count integer NOT NULL CHECK (operation_count>0),
  confirmed_count integer NOT NULL DEFAULT 0 CHECK (confirmed_count>=0 AND confirmed_count<=operation_count),
  last_operation_id text CHECK (last_operation_id ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'reserved'
    CHECK (state IN ('reserved','writing','complete','precondition_failed','outcome_unknown','reconciled')),
  reconciled_by text,
  reconciliation_sha256 text CHECK (reconciliation_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state<>'complete' OR (confirmed_count=operation_count AND last_operation_id IS NULL)),
  CHECK (state<>'precondition_failed' OR (confirmed_count=0 AND last_operation_id IS NULL)),
  CHECK ((state='reconciled' AND reconciled_by IS NOT NULL AND length(trim(reconciled_by))>0 AND reconciliation_sha256 IS NOT NULL)
    OR (state<>'reconciled' AND reconciled_by IS NULL AND reconciliation_sha256 IS NULL))
);
CREATE UNIQUE INDEX shopify_sync_one_inflight_location_idx ON public.shopify_sync_runs(shop_domain,location_gid)
  WHERE state IN ('reserved','writing','outcome_unknown');
CREATE INDEX shopify_sync_runs_created_idx ON public.shopify_sync_runs(created_at DESC);
CREATE TABLE public.shopify_sync_events (
  event_id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.shopify_sync_runs(run_id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('intent','confirmed','complete','outcome_unknown','precondition_failed','reconciled')),
  operation_id text CHECK (operation_id ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text,
  details jsonb,
  CHECK ((state IN ('intent','confirmed'))=(operation_id IS NOT NULL)),
  CHECK ((state='reconciled' AND reviewed_by IS NOT NULL AND length(trim(reviewed_by))>0
      AND details IS NOT NULL AND jsonb_typeof(details)='object')
    OR (state<>'reconciled' AND reviewed_by IS NULL AND details IS NULL))
);
CREATE INDEX shopify_sync_events_run_idx ON public.shopify_sync_events(run_id,created_at,event_id);
CREATE UNIQUE INDEX shopify_sync_events_operation_state_idx ON public.shopify_sync_events(run_id,operation_id,state)
  WHERE state IN ('intent','confirmed');
CREATE FUNCTION public.shopify_sync_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') OR TG_TABLE_NAME='shopify_sync_events' THEN
    RAISE EXCEPTION 'Sync audit evidence is immutable';
  END IF;
  IF NEW.run_id IS DISTINCT FROM OLD.run_id OR NEW.shop_domain IS DISTINCT FROM OLD.shop_domain
     OR NEW.location_gid IS DISTINCT FROM OLD.location_gid OR NEW.plan_digest IS DISTINCT FROM OLD.plan_digest
     OR NEW.plan_document IS DISTINCT FROM OLD.plan_document OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR NEW.operation_count IS DISTINCT FROM OLD.operation_count OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.confirmed_count<OLD.confirmed_count
     OR OLD.state IN ('complete','precondition_failed','reconciled')
     OR (OLD.state='outcome_unknown' AND NEW.state<>'reconciled')
     OR (NEW.state<>'reconciled' AND (NEW.reconciled_by IS DISTINCT FROM OLD.reconciled_by
       OR NEW.reconciliation_sha256 IS DISTINCT FROM OLD.reconciliation_sha256)) THEN
    RAISE EXCEPTION 'Sync run identity or terminal state is immutable; recovery needs explicit review';
  END IF;
  IF NEW.state='reconciled' AND NOT EXISTS (
    SELECT 1 FROM public.shopify_sync_events e WHERE e.run_id=NEW.run_id AND e.state='reconciled'
      AND e.reviewed_by=NEW.reconciled_by AND e.details->>'digest'=NEW.reconciliation_sha256
  ) THEN
    RAISE EXCEPTION 'Reconciliation requires retained reviewer evidence';
  END IF;
  IF NEW.confirmed_count IS DISTINCT FROM OLD.confirmed_count AND (
    NEW.confirmed_count<>OLD.confirmed_count+1 OR NEW.confirmed_count<>(
      SELECT count(*) FROM public.shopify_sync_events e WHERE e.run_id=NEW.run_id AND e.state='confirmed'
    )
  ) THEN
    RAISE EXCEPTION 'Confirmation count requires append-only event evidence';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER shopify_sync_runs_protect BEFORE UPDATE OR DELETE ON public.shopify_sync_runs
  FOR EACH ROW EXECUTE FUNCTION public.shopify_sync_protect();
CREATE TRIGGER shopify_sync_runs_no_truncate BEFORE TRUNCATE ON public.shopify_sync_runs
  FOR EACH STATEMENT EXECUTE FUNCTION public.shopify_sync_protect();
CREATE TRIGGER shopify_sync_events_protect BEFORE UPDATE OR DELETE ON public.shopify_sync_events
  FOR EACH ROW EXECUTE FUNCTION public.shopify_sync_protect();
CREATE TRIGGER shopify_sync_events_no_truncate BEFORE TRUNCATE ON public.shopify_sync_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.shopify_sync_protect();
COMMIT;
-- Before-use rollback (ONLY if never used and separately approved):
-- BEGIN;
-- DROP TABLE public.shopify_sync_events;
-- DROP TABLE public.shopify_sync_runs;
-- DROP FUNCTION public.shopify_sync_protect();
-- COMMIT;
-- Once used, retain the audit evidence; roll back application code, not history.
