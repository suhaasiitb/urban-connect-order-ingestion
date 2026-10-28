-- ==============================================================================
-- Migration: 20261028000001_dnr_reports_schema.sql
-- Purpose:   Store Delivery Not Received (DNR) cases and upload history.
--            Configures Row Level Security (RLS) and authenticated policies.
-- ==============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.store_dnr_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_code TEXT NOT NULL,
  week INTEGER,
  order_date TEXT,
  dp_id TEXT,
  order_id TEXT NOT NULL,
  rider_name TEXT,
  normalized_name TEXT,
  marked_del_from TEXT,
  abuse_flag TEXT NOT NULL DEFAULT 'Non_abusive',
  delivery_time TEXT,
  scan_data_delivered TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_store_dnr_order UNIQUE (order_id)
);

CREATE TABLE IF NOT EXISTS public.store_dnr_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_code TEXT,
  filename TEXT NOT NULL,
  total_records INTEGER NOT NULL,
  non_abusive_count INTEGER NOT NULL DEFAULT 0,
  potential_abuse_count INTEGER NOT NULL DEFAULT 0,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_store_dnr_records_site
  ON public.store_dnr_records (site_code);

CREATE INDEX IF NOT EXISTS idx_store_dnr_records_normalized
  ON public.store_dnr_records (normalized_name);

CREATE INDEX IF NOT EXISTS idx_store_dnr_records_abuse
  ON public.store_dnr_records (abuse_flag);

CREATE INDEX IF NOT EXISTS idx_store_dnr_uploads_uploaded_at
  ON public.store_dnr_uploads (uploaded_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.store_dnr_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_dnr_uploads ENABLE ROW LEVEL SECURITY;

-- Grants to authenticated and service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_dnr_records TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_dnr_uploads TO authenticated, service_role;

-- RLS Policies
DROP POLICY IF EXISTS "Allow authenticated select store_dnr_records" ON public.store_dnr_records;
CREATE POLICY "Allow authenticated select store_dnr_records"
  ON public.store_dnr_records FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow authenticated modify store_dnr_records" ON public.store_dnr_records;
CREATE POLICY "Allow authenticated modify store_dnr_records"
  ON public.store_dnr_records FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated select store_dnr_uploads" ON public.store_dnr_uploads;
CREATE POLICY "Allow authenticated select store_dnr_uploads"
  ON public.store_dnr_uploads FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow authenticated modify store_dnr_uploads" ON public.store_dnr_uploads;
CREATE POLICY "Allow authenticated modify store_dnr_uploads"
  ON public.store_dnr_uploads FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMIT;
