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

-- ==============================================================================
-- Baseline Audit Pre-seed (13 Historical Cases from User Audit File)
-- ==============================================================================
INSERT INTO public.store_dnr_records (
  week, order_date, site_code, dp_id, order_id, rider_name, normalized_name, marked_del_from, abuse_flag, delivery_time, scan_data_delivered
) VALUES
  (43, '2026-10-21 00:00', 'TPH1', '1083794', '405-8852180-8267501', 'Sehbudi Shekh', 'sehbudi shekh', 'From App', 'Non_abusive', '2026-10-22 00:12', '0-30m'),
  (43, '2026-10-18 00:00', 'TPE2', '1121550', '408-1216432-6134753', 'Prathamesh Balasaheb Kadam', 'prathamesh balasaheb kadam', 'From App', 'Potential_abuse', '2026-10-18 10:33', '0-30m'),
  (43, '2026-10-22 00:00', 'TPH1', '768878', '171-2515326-5568315', 'VISLAVATH ANIL NAIK', 'vislavath anil naik', 'Manual', 'Potential_abuse', '2026-10-22 21:16', '>500m'),
  (43, '2026-10-22 00:00', 'TMK7', '724190', '408-0582958-9981911', 'Chate Ashok Bharat', 'chate ashok bharat', 'From App', 'Potential_abuse', '2026-10-22 16:09', '0-30m'),
  (43, '2026-10-19 00:00', 'TPH1', '888547', '404-5173617-4043512', 'Nagnath Datta Kokate', 'nagnath datta kokate', 'From App', 'Non_abusive', '2026-10-19 20:29', '0-30m'),
  (43, '2026-10-18 00:00', 'TPH1', '1035267', '406-0769305-3459565', 'Ramrao Utthamrao Rathod', 'ramrao utthamrao rathod', 'From App', 'Non_abusive', '2026-10-18 20:16', '0-30m'),
  (43, '2026-10-19 00:00', 'TPH1', '767944', '406-6156536-1520306', 'Sunil ', 'sunil', 'Manual', 'Non_abusive', '2026-10-19 19:01', '>500m'),
  (43, '2026-10-18 00:00', 'TMK7', '1067791', '406-3978694-5733940', 'Rider (DP: 1067791)', 'dp:1067791', 'From App', 'Potential_abuse', '2026-10-18 00:12', '50-100m'),
  (43, '2026-10-19 00:00', 'TPH1', '938424', '404-9709272-3993968', 'Manohar Prabhakar Budhavant', 'manohar prabhakar budhavant', 'From App', 'Potential_abuse', '2026-10-19 14:19', '0-30m'),
  (43, '2026-10-18 00:00', 'TMK7', '1030709', '407-0286236-8549956', 'HEMANT DHOTRE', 'hemant dhotre', 'From App', 'Potential_abuse', '2026-10-18 19:10', '0-30m'),
  (43, '2026-10-20 00:00', 'TPH1', '1083794', '171-0205363-5333955', 'Sehbudi Shekh', 'sehbudi shekh', 'From App', 'Non_abusive', '2026-10-20 18:19', '0-30m'),
  (43, '2026-10-19 00:00', 'TPE2', '1126116', '405-4470710-1402748', 'JETHARAM CHOUDHARY', 'jetharam choudhary', 'From App', 'Non_abusive', '2026-10-19 13:10', '50-100m'),
  (43, '2026-10-18 00:00', 'TPH1', '875863', '408-5264812-3578756', 'Sushil Kumar Rai', 'sushil kumar rai', 'Manual', 'Non_abusive', '2026-10-18 14:08', '>500m')
ON CONFLICT (order_id) DO UPDATE SET
  week = EXCLUDED.week,
  order_date = EXCLUDED.order_date,
  site_code = EXCLUDED.site_code,
  dp_id = EXCLUDED.dp_id,
  rider_name = EXCLUDED.rider_name,
  normalized_name = EXCLUDED.normalized_name,
  marked_del_from = EXCLUDED.marked_del_from,
  abuse_flag = EXCLUDED.abuse_flag,
  delivery_time = EXCLUDED.delivery_time,
  scan_data_delivered = EXCLUDED.scan_data_delivered;

INSERT INTO public.store_dnr_uploads (
  site_code, filename, total_records, non_abusive_count, potential_abuse_count, uploaded_by
) VALUES (
  'ALL', 'Amazon_DNR_Baseline_Audit.xlsx', 13, 7, 6, 'System Pre-seed'
);

COMMIT;
