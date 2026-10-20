// ==============================================================================
// Strict Origin-Allowlist CORS Policy for Supabase Edge Functions
// Never uses wildcard (*) CORS as a substitute for authentication.
// Restricts browser requests to the configured GitHub Pages origin and
// local Vite development origins.
// ==============================================================================

export const DEFAULT_LOCAL_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];

export function parseAllowedOrigins(envAllowedOrigins?: string | null): string[] {
  const configured = (envAllowedOrigins ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => o.length > 0 && o !== '*');

  const merged = new Set<string>([
    ...DEFAULT_LOCAL_ORIGINS,
    ...configured,
  ]);
  return Array.from(merged);
}

export interface CorsEvaluation {
  allowed: boolean;
  headers: Record<string, string>;
}

/**
 * Evaluates the incoming Origin header against the configured origin allowlist.
 */
export function evaluateCorsOrigin(
  requestOrigin: string | null,
  allowedOrigins: string[]
): CorsEvaluation {
  const baseHeaders: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };

  // Non-browser / server-to-server requests without an Origin header are
  // still subject to strict Bearer JWT + admin_users verification.
  if (!requestOrigin) {
    return {
      allowed: true,
      headers: baseHeaders,
    };
  }

  const normalizedOrigin = requestOrigin.trim().replace(/\/+$/, '');
  const isAllowed = allowedOrigins.some(
    (allowed) => allowed.toLowerCase() === normalizedOrigin.toLowerCase()
  );

  if (!isAllowed) {
    return {
      allowed: false,
      headers: { Vary: 'Origin' },
    };
  }

  return {
    allowed: true,
    headers: {
      ...baseHeaders,
      'Access-Control-Allow-Origin': normalizedOrigin,
    },
  };
}
