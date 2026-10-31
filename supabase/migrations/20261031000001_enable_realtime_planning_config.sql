-- ==============================================================================
-- Migration: 20261031000001_enable_realtime_planning_config.sql
-- Purpose:   Add store_planning_config to supabase_realtime publication and set REPLICA IDENTITY FULL
--            so multi-session DPH changes broadcast instantly to all open clients.
-- ==============================================================================

ALTER TABLE public.store_planning_config REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'store_planning_config'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.store_planning_config;
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Fallback if publication doesn't exist yet in local development
  NULL;
END $$;
