-- ==============================================================================
-- Migration: 20261031000002_rider_attendance_schema.sql
-- Purpose:   Store next-day rider attendance and turn-up submissions.
--            Supports 'unmarked' (default), 'present', and 'absent' status.
--            Enables slot turn-up calculation from rider shift timings.
-- ==============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.store_rider_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE,
  warehouse_id TEXT NOT NULL,
  attendance_date DATE NOT NULL,
  rider_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  phone TEXT,
  shift_type TEXT NOT NULL DEFAULT 'Morning Shift',
  slot1_start_hour INTEGER NOT NULL DEFAULT 6 CHECK (slot1_start_hour >= 0 AND slot1_start_hour <= 23),
  slot1_end_hour INTEGER NOT NULL DEFAULT 15 CHECK (slot1_end_hour >= 0 AND slot1_end_hour <= 24),
  slot2_start_hour INTEGER CHECK (slot2_start_hour >= 0 AND slot2_start_hour <= 23),
  slot2_end_hour INTEGER CHECK (slot2_end_hour >= 0 AND slot2_end_hour <= 24),
  attendance_status TEXT NOT NULL DEFAULT 'unmarked' CHECK (attendance_status IN ('unmarked', 'present', 'absent')),
  is_present BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  CONSTRAINT uq_store_rider_attendance UNIQUE (warehouse_id, attendance_date, normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_store_rider_attendance_lookup
  ON public.store_rider_attendance (warehouse_id, attendance_date);

CREATE INDEX IF NOT EXISTS idx_store_rider_attendance_store
  ON public.store_rider_attendance (store_id, attendance_date);

-- Enable Row Level Security (RLS)
ALTER TABLE public.store_rider_attendance ENABLE ROW LEVEL SECURITY;

-- Set REPLICA IDENTITY FULL for granular real-time replication
ALTER TABLE public.store_rider_attendance REPLICA IDENTITY FULL;

-- Grants to authenticated, anon, and service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_rider_attendance TO authenticated, anon, service_role;

-- RLS Policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'store_rider_attendance'
      AND policyname = 'authenticated_store_rider_attendance_all'
  ) THEN
    CREATE POLICY authenticated_store_rider_attendance_all
      ON public.store_rider_attendance
      FOR ALL
      TO authenticated, anon
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Add to Realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'store_rider_attendance'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.store_rider_attendance;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

COMMIT;
