-- ==============================================================================
-- Migration: 20261118000002_add_incorrect_address_dsr_rca.sql
-- Purpose:   Allow 'Incorrect/Incomplete Address' in public.orders.dsr_rca
--            check constraint (chk_orders_dsr_rca_valid).
-- ==============================================================================

BEGIN;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS chk_orders_dsr_rca_valid;

ALTER TABLE public.orders
  ADD CONSTRAINT chk_orders_dsr_rca_valid
  CHECK (
    dsr_rca IS NULL OR dsr_rca IN (
      'Wrong Location',
      'Customer Unavailable',
      'Customer Rejected',
      'Vehicle Issue',
      'Product Missing',
      'Customer Unreachable/Not Responding',
      'Incorrect/Incomplete Address'
    )
  );

COMMIT;
