// ==============================================================================
// Public Supabase Client Configuration
// Uses ONLY the public project URL and anon/publishable key.
// Never include service_role keys or database passwords in frontend code.
// ==============================================================================

import { createClient } from '@supabase/supabase-js';

const rawUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const rawAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

export const isSupabaseConfigured =
  Boolean(rawUrl) &&
  Boolean(rawAnonKey) &&
  !rawUrl.includes('your-project-ref.supabase.co') &&
  !rawAnonKey.includes('your-public-anon-or-publishable-key');

export const supabaseUrl = isSupabaseConfigured
  ? rawUrl.replace(/\/+$/, '')
  : 'https://placeholder-unconfigured.supabase.co';

export const supabaseAnonKey = isSupabaseConfigured
  ? rawAnonKey
  : 'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
