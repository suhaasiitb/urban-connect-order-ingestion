// ==============================================================================
// Supabase Edge Function: ingest-orders
// Endpoint: POST /functions/v1/ingest-orders
// Responsibilities:
//   1. Enforce strict origin-allowlist CORS (ALLOWED_ORIGINS).
//   2. Verify authenticated user JWT and active administrator status.
//   3. Independently normalize, validate, and recalculate all 11 derived fields.
//   4. Execute atomic persistence via public.ingest_order_batch RPC using the
//      backend-only service_role key.
// ==============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { evaluateCorsOrigin, parseAllowedOrigins } from '../_shared/cors.ts';
import {
  handleIngestOrderBatch,
  type IngestBatchRpcResponse,
  type IngestionBackendAdapter,
  MAX_REQUEST_BODY_BYTES,
} from '../_shared/ingestionHandler.ts';
import type { StoreMaster } from '../_shared/types.ts';

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

Deno.serve(async (req: Request): Promise<Response> => {
  const allowedOrigins = parseAllowedOrigins(Deno.env.get('ALLOWED_ORIGINS'));
  const requestOrigin = req.headers.get('Origin');
  const cors = evaluateCorsOrigin(requestOrigin, allowedOrigins);

  if (!cors.allowed) {
    return new Response(
      JSON.stringify({
        ok: false,
        code: 'CORS_ORIGIN_FORBIDDEN',
        message: 'Origin is not permitted by CORS policy.',
      }),
      {
        status: 403,
        headers: {
          ...cors.headers,
          'Content-Type': 'application/json',
        },
      }
    );
  }

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: cors.headers,
    });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({
        ok: false,
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only POST requests are supported.',
      }),
      {
        status: 405,
        headers: {
          ...cors.headers,
          'Content-Type': 'application/json',
        },
      }
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return new Response(
      JSON.stringify({
        ok: false,
        code: 'SERVER_MISCONFIGURED',
        message: 'Required backend Supabase environment configuration is missing.',
      }),
      {
        status: 500,
        headers: {
          ...cors.headers,
          'Content-Type': 'application/json',
        },
      }
    );
  }

  // Service-role client (backend-only, never exposed to frontend)
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let rawBodyText = '';
  try {
    rawBodyText = await req.text();
  } catch {
    return new Response(
      JSON.stringify({
        ok: false,
        code: 'INVALID_BODY',
        message: 'Failed to read request body.',
      }),
      {
        status: 400,
        headers: {
          ...cors.headers,
          'Content-Type': 'application/json',
        },
      }
    );
  }

  const rawBodyLengthBytes = new TextEncoder().encode(rawBodyText).byteLength;
  if (rawBodyLengthBytes > MAX_REQUEST_BODY_BYTES) {
    return new Response(
      JSON.stringify({
        ok: false,
        code: 'PAYLOAD_TOO_LARGE',
        message: `Request body exceeds maximum allowed size of ${MAX_REQUEST_BODY_BYTES} bytes.`,
      }),
      {
        status: 413,
        headers: {
          ...cors.headers,
          'Content-Type': 'application/json',
        },
      }
    );
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(rawBodyText);
  } catch {
    return new Response(
      JSON.stringify({
        ok: false,
        code: 'INVALID_JSON',
        message: 'Request body must be valid JSON.',
      }),
      {
        status: 400,
        headers: {
          ...cors.headers,
          'Content-Type': 'application/json',
        },
      }
    );
  }

  const adapter: IngestionBackendAdapter = {
    async verifyAdminSession(authHeader: string | null) {
      if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
        return { authenticated: false, isAdmin: false, userId: null };
      }
      const token = authHeader.slice(7).trim();
      if (!token) {
        return { authenticated: false, isAdmin: false, userId: null };
      }

      const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data: userData, error: userErr } = await supabaseUserClient.auth.getUser(token);
      if (userErr || !userData?.user) {
        return { authenticated: false, isAdmin: false, userId: null };
      }

      const userId = userData.user.id;
      const { data: adminRow, error: adminErr } = await supabaseAdmin
        .from('admin_users')
        .select('user_id, email, is_active')
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle();

      if (adminErr || !adminRow) {
        return {
          authenticated: true,
          isAdmin: false,
          userId,
          email: userData.user.email,
        };
      }

      return {
        authenticated: true,
        isAdmin: true,
        userId,
        email: adminRow.email,
      };
    },

    async getActiveStoreById(storeId: string): Promise<StoreMaster | null> {
      const { data, error } = await supabaseAdmin
        .from('stores')
        .select('id, store_code, store_name, external_store_id, timezone, is_active')
        .eq('id', storeId)
        .eq('is_active', true)
        .maybeSingle();

      if (error || !data) return null;
      return data as StoreMaster;
    },

    async executeIngestBatchRpc(rpcParams): Promise<IngestBatchRpcResponse> {
      const { data, error } = await supabaseAdmin.rpc('ingest_order_batch', {
        p_store_id: rpcParams.storeId,
        p_uploaded_by: rpcParams.uploadedBy,
        p_original_filename: rpcParams.originalFilename,
        p_file_checksum_sha256: rpcParams.fileChecksumSha256,
        p_records: rpcParams.records,
        p_force_reprocess: rpcParams.forceReprocess,
        p_processing_metadata: rpcParams.processingMetadata,
      });

      if (error) {
        throw new Error(error.message);
      }
      return data as IngestBatchRpcResponse;
    },

    async recordFailedBatchRpc(failParams): Promise<string | null> {
      const { data, error } = await supabaseAdmin.rpc('record_failed_ingestion_batch', {
        p_store_id: failParams.storeId,
        p_uploaded_by: failParams.uploadedBy,
        p_original_filename: failParams.originalFilename,
        p_file_checksum_sha256: failParams.fileChecksumSha256,
        p_total_rows: failParams.totalRows,
        p_rejected_count: failParams.rejectedCount,
        p_error_summary: failParams.errorSummary,
        p_rejected_rows: failParams.rejectedRows,
        p_processing_metadata: failParams.processingMetadata,
      });

      if (error) return null;
      return (data as string) ?? null;
    },
  };

  const result = await handleIngestOrderBatch({
    authHeader: req.headers.get('Authorization'),
    rawBodyLengthBytes,
    payload: parsedPayload,
    adapter,
  });

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: {
      ...cors.headers,
      'Content-Type': 'application/json',
    },
  });
});
