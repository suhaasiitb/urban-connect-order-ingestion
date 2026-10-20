-- ==============================================================================
-- Migration: 20261019000001_core_schema.sql
-- Purpose:   Core relational schema for Urban Connect Daily Store Order Ingestion
--            Portal (admin_users, stores, ingestion_batches, orders,
--            ingestion_batch_rows, order_revision_history).
-- Rollback:  DROP TABLE IF EXISTS public.order_revision_history,
--            public.ingestion_batch_rows, public.orders,
--            public.ingestion_batches, public.stores, public.admin_users CASCADE;
--            DROP FUNCTION IF EXISTS public.set_updated_at() CASCADE;
-- ==============================================================================

BEGIN;

-- Ensure pgcrypto is available for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------------------------
-- 1. Utility Trigger Function: set_updated_at()
--    Used on master tables (stores, admin_users).
--    Note: public.orders manages updated_at explicitly inside the ingestion
--    transaction so that unchanged re-uploads never alter orders.updated_at.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. Table: public.admin_users
--    Explicit administrator allowlist linked to Supabase Auth (auth.users).
--    Only active administrators in this table may access stores, upload data,
--    or inspect orders and batch history.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE CHECK (char_length(trim(email)) > 3),
  full_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_users IS
  'Authorized administrators permitted to manage all configured stores and upload daily order workbooks.';

DROP TRIGGER IF EXISTS trg_admin_users_updated_at ON public.admin_users;
CREATE TRIGGER trg_admin_users_updated_at
  BEFORE UPDATE ON public.admin_users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------------------------
-- 3. Table: public.stores
--    Store master table separating internal UUIDs from external store codes/IDs.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_code TEXT NOT NULL UNIQUE CHECK (char_length(trim(store_code)) >= 2),
  store_name TEXT NOT NULL CHECK (char_length(trim(store_name)) > 0),
  external_store_id TEXT UNIQUE CHECK (external_store_id IS NULL OR char_length(trim(external_store_id)) > 0),
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.stores IS
  'Master configuration of stores. Separates internal UUID primary keys from business store_code (e.g. TMK7) and external_store_id (e.g. 4247).';

DROP TRIGGER IF EXISTS trg_stores_updated_at ON public.stores;
CREATE TRIGGER trg_stores_updated_at
  BEFORE UPDATE ON public.stores
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Seed reference store TMK7 (Amazon Narhe) idempotently
INSERT INTO public.stores (store_code, store_name, external_store_id, timezone, is_active)
VALUES ('TMK7', 'Amazon Narhe (TMK7)', '4247', 'Asia/Kolkata', true)
ON CONFLICT (store_code) DO UPDATE
SET
  store_name = EXCLUDED.store_name,
  external_store_id = EXCLUDED.external_store_id,
  timezone = EXCLUDED.timezone,
  is_active = EXCLUDED.is_active;

-- ------------------------------------------------------------------------------
-- 4. Table: public.ingestion_batches
--    Audit record for every workbook upload attempt.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ingestion_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  original_filename TEXT NOT NULL CHECK (char_length(trim(original_filename)) > 0),
  file_checksum_sha256 TEXT NOT NULL CHECK (file_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (
    status IN (
      'Pending',
      'Processing',
      'Succeeded',
      'Partially Succeeded',
      'Failed',
      'Duplicate Skipped'
    )
  ),
  min_order_date DATE,
  max_order_date DATE,
  total_rows INTEGER NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  inserted_count INTEGER NOT NULL DEFAULT 0 CHECK (inserted_count >= 0),
  updated_count INTEGER NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  unchanged_count INTEGER NOT NULL DEFAULT 0 CHECK (unchanged_count >= 0),
  rejected_count INTEGER NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  prior_batch_id UUID REFERENCES public.ingestion_batches(id) ON DELETE SET NULL,
  error_summary TEXT,
  processing_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

COMMENT ON TABLE public.ingestion_batches IS
  'Audit log of each workbook upload attempt, tracking file SHA-256 checksum, processing state, date range, and row outcome counts.';

CREATE INDEX IF NOT EXISTS idx_ingestion_batches_store_checksum
  ON public.ingestion_batches (store_id, file_checksum_sha256);

CREATE INDEX IF NOT EXISTS idx_ingestion_batches_store_started
  ON public.ingestion_batches (store_id, started_at DESC);

-- ------------------------------------------------------------------------------
-- 5. Table: public.orders
--    Canonical order records across all stores (29 source fields + 11 derived
--    fields + audit/hash metadata).
--    Uniqueness constraint: UNIQUE (store_id, order_id).
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,

  -- 29 Source Columns from 'Raw Data' worksheet
  rider_number TEXT,                                                           -- 1.  A: Rider Number
  arrived_pickup_at TIMESTAMPTZ,                                               -- 2.  B: Arrived Pickup At
  lm_distance INTEGER CHECK (lm_distance IS NULL OR lm_distance >= 0),         -- 3.  C: LM Distance (meters)
  resting_point_name TEXT,                                                     -- 4.  D: Resting Point Name
  total_eta NUMERIC(10,2),                                                     -- 5.  E: Total ETA
  completed_at TIMESTAMPTZ,                                                    -- 6.  F: Completed At
  resting_point_id TEXT,                                                       -- 7.  G: Resting Point ID
  source_store_name TEXT NOT NULL,                                             -- 8.  H: Store Name
  pickup_at TIMESTAMPTZ,                                                       -- 9.  I: Pickup At
  order_eta_status TEXT,                                                       -- 10. J: Order ETA Status
  staged_at TIMESTAMPTZ,                                                       -- 11. K: Staged At
  pickup_eta NUMERIC(10,2),                                                    -- 12. L: Pickup ETA
  arrive_at_pickup_eta TIMESTAMPTZ,                                            -- 13. M: Arrive at Pickup ETA
  status_text TEXT,                                                            -- 14. N: Status Text
  order_created_at TIMESTAMPTZ NOT NULL,                                       -- 15. O: Created At
  status TEXT NOT NULL CHECK (char_length(trim(status)) > 0),                  -- 16. P: Status
  rider_name TEXT,                                                             -- 17. Q: Rider Name
  order_id TEXT NOT NULL CHECK (char_length(trim(order_id)) > 0),              -- 18. R: Order ID
  external_store_id TEXT NOT NULL,                                             -- 19. S: Store ID
  total_time NUMERIC(10,2),                                                    -- 20. T: Total Time
  arrive_at_delivery_eta TIMESTAMPTZ,                                          -- 21. U: Arrive at Delivery ETA
  arrived_delivery_at TIMESTAMPTZ,                                             -- 22. V: Arrived Delivery At
  tracking_url TEXT,                                                           -- 23. W: Tracking URL
  customer_id TEXT,                                                            -- 24. X: Customer ID
  rto_at TIMESTAMPTZ,                                                          -- 25. Y: RTO At
  fm_distance NUMERIC(10,2) CHECK (fm_distance IS NULL OR fm_distance >= 0),   -- 26. Z: FM Distance
  assigned_at TIME,                                                            -- 27. AA: Assigned At (Time of day)
  delivery_eta NUMERIC(10,2),                                                  -- 28. AB: Delivery ETA
  source_batch_id TEXT,                                                        -- 29. AC: Batch ID

  -- 11 Derived Columns (AD to AN) calculated by authoritative backend logic
  order_type TEXT NOT NULL CHECK (order_type IN ('Actual', 'Dummy')),          -- 30. AD: Order Type
  store_code TEXT NOT NULL,                                                    -- 31. AE: Store Code
  slot_hour SMALLINT NOT NULL CHECK (slot_hour BETWEEN 0 AND 23),              -- 32. AF: Slot (0-23 in store timezone)
  order_date DATE NOT NULL,                                                    -- 33. AG: Date (Full YYYY-MM-DD in store timezone)
  staging_to_pickup_minutes NUMERIC(10,4) NOT NULL,                            -- 34. AH: Time ((Pickup At - Staged At) in minutes)
  s2p_minutes NUMERIC(10,4) NOT NULL CHECK (s2p_minutes >= 0),                 -- 35. AI: S2P (MAX(AH, 0))
  distance_meters INTEGER NOT NULL CHECK (distance_meters >= 0),               -- 36. AJ: Distance (LM Distance in meters)
  actual_arrival_minutes NUMERIC(10,4) NOT NULL,                               -- 37. AK: Actual Arrival Time (minutes)
  arrival_eta_minutes NUMERIC(10,4) NOT NULL,                                  -- 38. AL: Arrival Time ETA (minutes)
  otp_performance TEXT NOT NULL CHECK (
    otp_performance IN ('OTP Achieved', 'OTP Breached', 'Not Applicable')
  ),                                                                           -- 39. AM: OTP Performance
  otp_plus_3_performance TEXT NOT NULL CHECK (
    otp_plus_3_performance IN ('OTP Achieved', 'OTP Breached', 'Not Applicable')
  ),                                                                           -- 40. AN: OTP+3 Performance

  -- Reconciliation & Audit Metadata
  source_row_hash TEXT NOT NULL CHECK (source_row_hash ~ '^[0-9a-f]{64}$'),
  raw_source_snapshot JSONB NOT NULL,
  last_ingestion_batch_id UUID REFERENCES public.ingestion_batches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_orders_store_order UNIQUE (store_id, order_id)
);

COMMENT ON TABLE public.orders IS
  'Canonical multi-store order table storing all 29 source columns and all 11 derived business columns per (store_id, order_id).';

CREATE INDEX IF NOT EXISTS idx_orders_store_date
  ON public.orders (store_id, order_date);

CREATE INDEX IF NOT EXISTS idx_orders_store_date_slot
  ON public.orders (store_id, order_date, slot_hour);

CREATE INDEX IF NOT EXISTS idx_orders_last_batch
  ON public.orders (last_ingestion_batch_id);

-- ------------------------------------------------------------------------------
-- 6. Table: public.ingestion_batch_rows
--    Row-level audit record for every worksheet row in an upload batch.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ingestion_batch_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.ingestion_batches(id) ON DELETE CASCADE,
  source_row_number INTEGER NOT NULL CHECK (source_row_number >= 2),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  order_id TEXT,
  action TEXT NOT NULL CHECK (
    action IN ('inserted', 'updated', 'unchanged', 'rejected', 'failed')
  ),
  row_hash TEXT,
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_snapshot JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_batch_row_number UNIQUE (batch_id, source_row_number)
);

COMMENT ON TABLE public.ingestion_batch_rows IS
  'Per-row outcome tracking for every uploaded workbook row, enabling exact reconciliation with batch summary counts.';

CREATE INDEX IF NOT EXISTS idx_batch_rows_batch_action
  ON public.ingestion_batch_rows (batch_id, action);

CREATE INDEX IF NOT EXISTS idx_batch_rows_store_order
  ON public.ingestion_batch_rows (store_id, order_id);

-- ------------------------------------------------------------------------------
-- 7. Table: public.order_revision_history
--    Historical versions of canonical orders whenever an existing order changes
--    (plus optional initial INSERT snapshot for complete lineage).
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_revision_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_row_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE RESTRICT,
  order_id TEXT NOT NULL,
  batch_id UUID NOT NULL REFERENCES public.ingestion_batches(id) ON DELETE RESTRICT,
  action_type TEXT NOT NULL CHECK (action_type IN ('INSERT', 'UPDATE')),
  changed_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  previous_source_snapshot JSONB,
  new_source_snapshot JSONB NOT NULL,
  previous_derived_snapshot JSONB,
  new_derived_snapshot JSONB NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.order_revision_history IS
  'Immutable audit log of changes to canonical orders, preserving before-and-after source and derived snapshots.';

CREATE INDEX IF NOT EXISTS idx_order_revisions_order_row
  ON public.order_revision_history (order_row_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_revisions_batch
  ON public.order_revision_history (batch_id);

COMMIT;
