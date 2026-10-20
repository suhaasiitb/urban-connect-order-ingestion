// ==============================================================================
// Store Master Service
// Loads active stores from public.stores via Supabase Data API (protected by RLS).
// ==============================================================================

import { supabase } from '../config/supabaseClient';
import type { StoreMaster } from '../domain/types';

export async function fetchActiveStores(): Promise<{
  stores: StoreMaster[];
  error?: string;
}> {
  const { data, error } = await supabase
    .from('stores')
    .select('id, store_code, store_name, external_store_id, timezone, is_active')
    .eq('is_active', true)
    .order('store_code', { ascending: true });

  if (error) {
    return {
      stores: [],
      error: `Failed to load active stores: ${error.message}`,
    };
  }

  return {
    stores: (data ?? []) as StoreMaster[],
  };
}
