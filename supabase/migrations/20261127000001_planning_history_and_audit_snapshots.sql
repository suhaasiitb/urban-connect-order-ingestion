-- ==============================================================================
-- Migration: 20261127000001_planning_history_and_audit_snapshots.sql
-- Purpose:
--   1. Per-date Target DPH snapshots (public.store_planning_daily_config) so
--      changing today's store Target DPH never retroactively alters historical
--      Required Riders counts.
--   2. Persistent daily Plan vs Actual Audit snapshots
--      (public.plan_vs_actual_audit_snapshots) so historical audits remain
--      reviewable even after raw orders older than 30 days are pruned.
--   3. Fast RPC public.get_store_attendance_dates(p_warehouse_id) returning
--      all distinct saved attendance dates for a store without row-limit
--      truncation.
-- ==============================================================================

BEGIN;

-- 1. Per-date Target DPH snapshots
CREATE TABLE IF NOT EXISTS public.store_planning_daily_config (
  site_code TEXT NOT NULL,
  planning_date DATE NOT NULL,
  target_dph NUMERIC(5,2) NOT NULL CHECK (target_dph > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  PRIMARY KEY (site_code, planning_date)
);

CREATE INDEX IF NOT EXISTS idx_store_planning_daily_config_lookup
  ON public.store_planning_daily_config (site_code, planning_date DESC);

ALTER TABLE public.store_planning_daily_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_planning_daily_config REPLICA IDENTITY FULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_planning_daily_config
  TO authenticated, anon, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'store_planning_daily_config'
      AND policyname = 'authenticated_store_planning_daily_config_all'
  ) THEN
    CREATE POLICY authenticated_store_planning_daily_config_all
      ON public.store_planning_daily_config
      FOR ALL
      TO authenticated, anon
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'store_planning_daily_config'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.store_planning_daily_config;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Backfill existing historical attendance dates with each store's current Target DPH
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'store_rider_attendance'
  ) THEN
    INSERT INTO public.store_planning_daily_config (site_code, planning_date, target_dph, updated_by)
    SELECT DISTINCT
      UPPER(TRIM(a.warehouse_id)) AS site_code,
      a.attendance_date AS planning_date,
      COALESCE(
        c.target_dph,
        CASE WHEN UPPER(TRIM(a.warehouse_id)) = 'TPE2' THEN 1.80 ELSE 2.10 END
      ) AS target_dph,
      'Migration Backfill'
    FROM public.store_rider_attendance a
    LEFT JOIN public.store_planning_config c
      ON UPPER(TRIM(c.site_code)) = UPPER(TRIM(a.warehouse_id))
    WHERE a.warehouse_id IS NOT NULL
      AND a.attendance_date IS NOT NULL
    ON CONFLICT (site_code, planning_date) DO NOTHING;
  END IF;
END $$;

-- 2. Persistent Plan vs Actual Audit Snapshots (survives 30-day orders pruning)
CREATE TABLE IF NOT EXISTS public.plan_vs_actual_audit_snapshots (
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  warehouse_id TEXT NOT NULL,
  audit_date DATE NOT NULL,
  total_orders_count INTEGER NOT NULL DEFAULT 0,
  total_roster_count INTEGER NOT NULL DEFAULT 0,
  planned_present_count INTEGER NOT NULL DEFAULT 0,
  planned_worked_count INTEGER NOT NULL DEFAULT 0,
  actual_worked_count INTEGER NOT NULL DEFAULT 0,
  turn_up_rate_pct INTEGER NOT NULL DEFAULT 0,
  no_show_count INTEGER NOT NULL DEFAULT 0,
  late_arrival_count INTEGER NOT NULL DEFAULT 0,
  avg_late_arrival_hours NUMERIC(5,1) NOT NULL DEFAULT 0,
  early_departure_count INTEGER NOT NULL DEFAULT 0,
  total_missed_slot_hours INTEGER NOT NULL DEFAULT 0,
  unplanned_turn_up_count INTEGER NOT NULL DEFAULT 0,
  compliant_count INTEGER NOT NULL DEFAULT 0,
  has_order_data BOOLEAN NOT NULL DEFAULT false,
  has_attendance_data BOOLEAN NOT NULL DEFAULT false,
  hourly_slots JSONB NOT NULL DEFAULT '[]'::jsonb,
  riders JSONB NOT NULL DEFAULT '[]'::jsonb,
  snapshot_version INTEGER NOT NULL DEFAULT 1,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, audit_date)
);

CREATE INDEX IF NOT EXISTS idx_plan_vs_actual_audit_wh_date
  ON public.plan_vs_actual_audit_snapshots (warehouse_id, audit_date DESC);

ALTER TABLE public.plan_vs_actual_audit_snapshots ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_vs_actual_audit_snapshots
  TO authenticated, anon, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'plan_vs_actual_audit_snapshots'
      AND policyname = 'authenticated_plan_vs_actual_audit_snapshots_all'
  ) THEN
    CREATE POLICY authenticated_plan_vs_actual_audit_snapshots_all
      ON public.plan_vs_actual_audit_snapshots
      FOR ALL
      TO authenticated, anon
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- 3. Fast distinct attendance dates RPC (avoids PostgREST row-limit truncation)
CREATE OR REPLACE FUNCTION public.get_store_attendance_dates(
  p_warehouse_id TEXT
)
RETURNS TABLE (attendance_date DATE)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT a.attendance_date
  FROM public.store_rider_attendance a
  WHERE UPPER(TRIM(a.warehouse_id)) = UPPER(TRIM(p_warehouse_id))
  ORDER BY a.attendance_date DESC;
$$;

REVOKE ALL ON FUNCTION public.get_store_attendance_dates(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_attendance_dates(TEXT)
  TO authenticated, anon, service_role;

COMMIT;
