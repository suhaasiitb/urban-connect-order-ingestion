// ==============================================================================
// Administrator Authentication & Session Verification Service
// Uses Supabase Auth and verifies active membership in public.admin_users.
// ==============================================================================

import { isSupabaseConfigured, supabase } from '../config/supabaseClient';

export interface AdminProfile {
  user_id: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
}

export interface AuthStateResult {
  admin: AdminProfile | null;
  error?: string;
}

/**
 * Verifies the active Supabase Auth session and checks that the user is listed
 * as an active administrator in public.admin_users.
 */
export async function getCurrentAdminProfile(): Promise<AuthStateResult> {
  if (!isSupabaseConfigured) {
    return { admin: null };
  }

  const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr || !sessionData.session) {
    return { admin: null };
  }

  const user = sessionData.session.user;
  const { data: adminRow, error: adminErr } = await supabase
    .from('admin_users')
    .select('user_id, email, full_name, is_active')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();

  if (adminErr || !adminRow) {
    await supabase.auth.signOut();
    return {
      admin: null,
      error:
        'Your account is authenticated but is not registered as an active administrator in public.admin_users.',
    };
  }

  return {
    admin: adminRow as AdminProfile,
  };
}

/**
 * Signs in an administrator with email and password, verifying active admin
 * authorization before granting portal access.
 */
export async function signInAdmin(
  email: string,
  password: string
): Promise<AuthStateResult> {
  if (!isSupabaseConfigured) {
    return {
      admin: null,
      error:
        'Supabase environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY) are not configured yet. Copy .env.example to .env.local and add your project credentials.',
    };
  }

  const trimmedEmail = email.trim();
  if (!trimmedEmail || !password) {
    return {
      admin: null,
      error: 'Please enter both your administrator email and password.',
    };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: trimmedEmail,
    password,
  });

  if (error || !data.user) {
    return {
      admin: null,
      error: error?.message || 'Invalid login credentials.',
    };
  }

  const { data: adminRow, error: adminErr } = await supabase
    .from('admin_users')
    .select('user_id, email, full_name, is_active')
    .eq('user_id', data.user.id)
    .eq('is_active', true)
    .maybeSingle();

  if (adminErr || !adminRow) {
    await supabase.auth.signOut();
    return {
      admin: null,
      error:
        'Access denied: Your user account is not listed as an active administrator in public.admin_users.',
    };
  }

  return {
    admin: adminRow as AdminProfile,
  };
}

/**
 * Signs out the current administrator session.
 */
export async function signOutAdmin(): Promise<void> {
  if (!isSupabaseConfigured) return;
  await supabase.auth.signOut();
}
