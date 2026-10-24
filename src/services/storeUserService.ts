// ==============================================================================
// Store Users Management Service
// Allows administrators to query, provision, link, and toggle store operators.
// ==============================================================================

import { supabase } from '../config/supabaseClient';

export interface StoreUserRecord {
  user_id: string;
  store_id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  stores?: {
    id: string;
    store_code: string;
    store_name: string;
  } | null;
}

export interface RegisterStoreUserParams {
  email: string;
  storeCode: string;
  fullName?: string;
}

export interface RegisterStoreUserResult {
  ok: boolean;
  code?: string;
  message?: string;
  user_id?: string;
  store_id?: string;
}

/**
 * Fetches all registered store user accounts with their assigned store details.
 */
export async function fetchStoreUsers(): Promise<{
  users: StoreUserRecord[];
  error?: string;
}> {
  const { data, error } = await supabase
    .from('store_users')
    .select(`
      user_id,
      store_id,
      email,
      full_name,
      is_active,
      created_at,
      updated_at,
      stores (
        id,
        store_code,
        store_name
      )
    `)
    .order('created_at', { ascending: false });

  if (error) {
    return {
      users: [],
      error: `Failed to load store users: ${error.message}`,
    };
  }

  const list = (data ?? []).map((row) => {
    const storeObj = Array.isArray(row.stores) ? row.stores[0] : row.stores;
    return {
      ...row,
      stores: storeObj ?? null,
    } as StoreUserRecord;
  });

  return { users: list };
}

/**
 * Registers or links an existing Supabase Auth user to an active store.
 */
export async function registerStoreUser(
  params: RegisterStoreUserParams
): Promise<RegisterStoreUserResult> {
  const { email, storeCode, fullName } = params;

  const { data, error } = await supabase.rpc('register_store_user', {
    p_email: email.trim().toLowerCase(),
    p_store_code: storeCode.trim().toUpperCase(),
    p_full_name: fullName?.trim() || null,
  });

  if (error) {
    return {
      ok: false,
      code: 'RPC_ERROR',
      message: error.message,
    };
  }

  return data as RegisterStoreUserResult;
}

/**
 * Updates an operator's active status (activate or deactivate login access).
 */
export async function setStoreUserActive(
  userId: string,
  isActive: boolean
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('store_users')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Deletes a store user linkage (removes their access to the store portal).
 */
export async function deleteStoreUser(
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('store_users')
    .delete()
    .eq('user_id', userId);

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
