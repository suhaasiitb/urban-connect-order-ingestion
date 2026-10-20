-- ==============================================================================
-- Migration: 20261019000002_rls_and_grants.sql
-- Purpose:   Least-privilege database grants, administrator verification helper,
--            and Row-Level Security (RLS) policies on all portal tables.
-- Rollback:  DROP POLICY IF EXISTS ... ON public.<table_name>;
--            DROP FUNCTION IF EXISTS public.is_active_admin() CASCADE;
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Helper Function: public.is_active_admin()
--    Verifies that the current Supabase Auth session belongs to an active
--    administrator in public.admin_users.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_active_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT is_active
      FROM public.admin_users
      WHERE user_id = auth.uid()
        AND is_active = true
      LIMIT 1
    ),
    false
  );
$$;

COMMENT ON FUNCTION public.is_active_admin() IS
  'Returns true if the current authenticated user (auth.uid()) is an active administrator in public.admin_users.';

REVOKE ALL ON FUNCTION public.is_active_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_admin() TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 2. Enable Row-Level Security (RLS) on All Tables
-- ------------------------------------------------------------------------------
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingestion_batch_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_revision_history ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 3. Deliberate Least-Privilege Table Grants
--    - Revoke all default privileges from PUBLIC, anon, and authenticated.
--    - Grant SELECT to authenticated (strictly filtered by RLS policies below).
--    - Never grant client-side INSERT/UPDATE/DELETE on orders or audit tables;
--      all ingestion writes must pass through the verified Edge Function + RPC.
-- ------------------------------------------------------------------------------
REVOKE ALL ON TABLE
  public.admin_users,
  public.stores,
  public.ingestion_batches,
  public.orders,
  public.ingestion_batch_rows,
  public.order_revision_history
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.admin_users,
  public.stores,
  public.ingestion_batches,
  public.orders,
  public.ingestion_batch_rows,
  public.order_revision_history
TO authenticated;

GRANT ALL PRIVILEGES ON TABLE
  public.admin_users,
  public.stores,
  public.ingestion_batches,
  public.orders,
  public.ingestion_batch_rows,
  public.order_revision_history
TO service_role;

-- ------------------------------------------------------------------------------
-- 4. RLS Policies (Administrator-Only Read Access; Zero Anonymous Access)
-- ------------------------------------------------------------------------------

-- A. public.admin_users
DROP POLICY IF EXISTS admin_users_select_own_or_admin ON public.admin_users;
CREATE POLICY admin_users_select_own_or_admin
  ON public.admin_users
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_active_admin());

-- B. public.stores
DROP POLICY IF EXISTS stores_select_active_admin ON public.stores;
CREATE POLICY stores_select_active_admin
  ON public.stores
  FOR SELECT
  TO authenticated
  USING (public.is_active_admin());

-- C. public.ingestion_batches
DROP POLICY IF EXISTS ingestion_batches_select_active_admin ON public.ingestion_batches;
CREATE POLICY ingestion_batches_select_active_admin
  ON public.ingestion_batches
  FOR SELECT
  TO authenticated
  USING (public.is_active_admin());

-- D. public.orders
DROP POLICY IF EXISTS orders_select_active_admin ON public.orders;
CREATE POLICY orders_select_active_admin
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (public.is_active_admin());

-- E. public.ingestion_batch_rows
DROP POLICY IF EXISTS ingestion_batch_rows_select_active_admin ON public.ingestion_batch_rows;
CREATE POLICY ingestion_batch_rows_select_active_admin
  ON public.ingestion_batch_rows
  FOR SELECT
  TO authenticated
  USING (public.is_active_admin());

-- F. public.order_revision_history
DROP POLICY IF EXISTS order_revision_history_select_active_admin ON public.order_revision_history;
CREATE POLICY order_revision_history_select_active_admin
  ON public.order_revision_history
  FOR SELECT
  TO authenticated
  USING (public.is_active_admin());

COMMIT;
