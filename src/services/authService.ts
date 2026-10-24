// ==============================================================================
// Authentication & Role-Based Session Verification Service
// Verifies active membership in public.admin_users (Superadmin: all stores)
// or public.store_users (Store operator: single assigned store).
// ==============================================================================

import { isSupabaseConfigured, supabase } from '../config/supabaseClient';

export type UserRole = 'admin' | 'store_user';

export interface UserProfile {
  user_id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  store_id: string | null; // null for admin, UUID for store_user
  store_code?: string | null;
  store_name?: string | null;
  is_active: boolean;
}

// Backward compatibility alias
export type AdminProfile = UserProfile;

export interface AuthStateResult {
  user: UserProfile | null;
  admin: UserProfile | null; // Alias for backward compatibility
  error?: string;
}

interface StoreJoined {
  id?: string;
  store_code?: string;
  store_name?: string;
}

/**
 * Resolves the authenticated user profile:
 * 1. Checks public.admin_users for active administrator status (access to all stores).
 * 2. Checks public.store_users for active store assignment (access to single store).
 */
export async function getCurrentUserProfile(): Promise<AuthStateResult> {
  if (!isSupabaseConfigured) {
    return { user: null, admin: null };
  }

  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr || !sessionData.session) {
    return { user: null, admin: null };
  }

  const authUser = sessionData.session.user;

  // 1. Check if user is an active administrator in public.admin_users
  const { data: adminRow } = await supabase
    .from('admin_users')
    .select('user_id, email, full_name, is_active')
    .eq('user_id', authUser.id)
    .eq('is_active', true)
    .maybeSingle();

  if (adminRow) {
    const profile: UserProfile = {
      user_id: adminRow.user_id,
      email: adminRow.email,
      full_name: adminRow.full_name,
      role: 'admin',
      store_id: null,
      is_active: adminRow.is_active,
    };
    return { user: profile, admin: profile };
  }

  // 2. Check if user is an active store operator in public.store_users
  const { data: storeUserRow } = await supabase
    .from('store_users')
    .select(`
      user_id,
      store_id,
      email,
      full_name,
      is_active,
      stores (
        id,
        store_code,
        store_name
      )
    `)
    .eq('user_id', authUser.id)
    .eq('is_active', true)
    .maybeSingle();

  if (storeUserRow) {
    const storeObj: StoreJoined | null = Array.isArray(storeUserRow.stores)
      ? (storeUserRow.stores[0] as StoreJoined)
      : (storeUserRow.stores as StoreJoined | null);

    const profile: UserProfile = {
      user_id: storeUserRow.user_id,
      email: storeUserRow.email,
      full_name: storeUserRow.full_name,
      role: 'store_user',
      store_id: storeUserRow.store_id,
      store_code: storeObj?.store_code ?? null,
      store_name: storeObj?.store_name ?? null,
      is_active: storeUserRow.is_active,
    };
    return { user: profile, admin: profile };
  }

  // Authenticated in Supabase Auth but not registered in either role table
  await supabase.auth.signOut();
  return {
    user: null,
    admin: null,
    error:
      'Access denied: Your account is authenticated but is not registered as an active administrator or store operator.',
  };
}

/**
 * Backward compatibility alias for getCurrentUserProfile
 */
export const getCurrentAdminProfile = getCurrentUserProfile;

/**
 * Signs in a user with email and password, resolving their role (admin or store_user).
 */
export async function signInUser(
  email: string,
  password: string
): Promise<AuthStateResult> {
  if (!isSupabaseConfigured) {
    return {
      user: null,
      admin: null,
      error:
        'Supabase environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY) are not configured yet. Copy .env.example to .env.local and add your project credentials.',
    };
  }

  const trimmedEmail = email.trim();
  if (!trimmedEmail || !password) {
    return {
      user: null,
      admin: null,
      error: 'Please enter both your account email and password.',
    };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: trimmedEmail,
    password,
  });

  if (error || !data.user) {
    return {
      user: null,
      admin: null,
      error: error?.message || 'Invalid login credentials.',
    };
  }

  return getCurrentUserProfile();
}

/**
 * Backward compatibility alias for signInUser
 */
export const signInAdmin = signInUser;

/**
 * Signs out the current session.
 */
export async function signOutUser(): Promise<void> {
  if (!isSupabaseConfigured) return;
  await supabase.auth.signOut();
}

/**
 * Backward compatibility alias for signOutUser
 */
export const signOutAdmin = signOutUser;
