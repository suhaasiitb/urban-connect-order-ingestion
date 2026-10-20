import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  evaluateCorsOrigin,
  parseAllowedOrigins,
} from '../../supabase/functions/_shared/cors';
import {
  handleIngestOrderBatch,
  type IngestBatchRpcResponse,
  type IngestionBackendAdapter,
  type SubmittedWorkbookRow,
} from '../../supabase/functions/_shared/ingestionHandler';
import { isBlankOrNullLiteral } from '../../supabase/functions/_shared/normalizer';
import {
  EXPECTED_RAW_HEADERS,
  type RawCellValue,
  type RawOrderRow,
  type StoreMaster,
} from '../../supabase/functions/_shared/types';
import { RAW_DATA_SHEET_NAME } from '../../src/domain/excelParser';
import { sha256Bytes } from '../../src/domain/hash';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations');
const FIXTURE_PATH = path.resolve(
  __dirname,
  '../fixtures/Amazon Narhe - Reports-2.xlsx'
);

const ADMIN_USER_ID = '00000000-0000-4000-8000-000000000010';
const NON_ADMIN_USER_ID = '00000000-0000-4000-8000-000000000020';

function extractRawRowsFromWorkbook(fileBytes: Uint8Array): SubmittedWorkbookRow[] {
  const wb = XLSX.read(fileBytes, { type: 'array', cellDates: false, raw: true });
  const sheet = wb.Sheets[RAW_DATA_SHEET_NAME];
  const matrix = XLSX.utils.sheet_to_json<RawCellValue[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });

  const headers = (matrix[0] ?? []).map((c) => (c === null || c === undefined ? '' : String(c).trim()));
  const rows: SubmittedWorkbookRow[] = [];

  for (let rIdx = 1; rIdx < matrix.length; rIdx++) {
    const rowCells = matrix[rIdx];
    if (!rowCells || rowCells.length === 0) continue;

    const rawRow = {} as RawOrderRow;
    let hasValue = false;
    for (const expected of EXPECTED_RAW_HEADERS) {
      const colIdx = headers.findIndex((h) => h.toLowerCase() === expected.toLowerCase());
      const val = colIdx !== -1 ? (rowCells[colIdx] ?? null) : null;
      rawRow[expected] = val;
      if (!isBlankOrNullLiteral(val)) hasValue = true;
    }
    if (!hasValue) continue;
    rows.push({
      source_row_number: rIdx + 1,
      raw_row: rawRow,
    });
  }
  return rows;
}

describe('Phase 3 — Secure Ingestion Backend & Atomic Persistence Suite', () => {
  let db: PGlite;
  let tmk7StoreId: string;
  let adapter: IngestionBackendAdapter;

  beforeAll(async () => {
    db = new PGlite();

    // Bootstrap Supabase roles and auth schema
    await db.exec(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
          CREATE ROLE service_role NOLOGIN BYPASSRLS;
        END IF;
      END
      $$;

      CREATE SCHEMA IF NOT EXISTS auth;

      CREATE TABLE IF NOT EXISTS auth.users (
        id UUID PRIMARY KEY,
        email TEXT UNIQUE,
        raw_app_meta_data JSONB,
        raw_user_meta_data JSONB,
        aud TEXT,
        role TEXT,
        created_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ
      );

      CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS UUID
      LANGUAGE sql
      STABLE
      AS $func$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
      $func$;
    `);

    const m1 = fs
      .readFileSync(path.join(MIGRATIONS_DIR, '20261019000001_core_schema.sql'), 'utf8')
      .replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/gi, '');
    const m2 = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20261019000002_rls_and_grants.sql'),
      'utf8'
    );
    const m3 = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20261019000003_ingest_batch_rpc.sql'),
      'utf8'
    );

    await db.exec(m1);
    await db.exec(m2);
    await db.exec(m3);

    // Seed an active admin user and a non-admin authenticated user
    await db.query(
      `INSERT INTO auth.users (id, email, aud, role, created_at, updated_at)
       VALUES
         ($1, 'admin@urbanconnect.in', 'authenticated', 'authenticated', now(), now()),
         ($2, 'viewer@urbanconnect.in', 'authenticated', 'authenticated', now(), now())`,
      [ADMIN_USER_ID, NON_ADMIN_USER_ID]
    );

    await db.query(
      `INSERT INTO public.admin_users (user_id, email, full_name, is_active)
       VALUES ($1, 'admin@urbanconnect.in', 'Portal Admin', true)`,
      [ADMIN_USER_ID]
    );

    const storeRes = await db.query<{ id: string }>(
      `SELECT id FROM public.stores WHERE store_code = 'TMK7' LIMIT 1`
    );
    tmk7StoreId = storeRes.rows[0].id;

    // Create PGlite-backed IngestionBackendAdapter
    adapter = {
      async verifyAdminSession(authHeader: string | null) {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return { authenticated: false, isAdmin: false, userId: null };
        }
        const token = authHeader.slice(7).trim();
        if (token === 'valid-admin-token') {
          const check = await db.query<{ is_active: boolean }>(
            `SELECT is_active FROM public.admin_users WHERE user_id = $1 AND is_active = true`,
            [ADMIN_USER_ID]
          );
          return {
            authenticated: true,
            isAdmin: check.rows.length > 0,
            userId: ADMIN_USER_ID,
            email: 'admin@urbanconnect.in',
          };
        }
        if (token === 'valid-non-admin-token') {
          return {
            authenticated: true,
            isAdmin: false,
            userId: NON_ADMIN_USER_ID,
            email: 'viewer@urbanconnect.in',
          };
        }
        return { authenticated: false, isAdmin: false, userId: null };
      },

      async getActiveStoreById(storeId: string): Promise<StoreMaster | null> {
        const res = await db.query<StoreMaster>(
          `SELECT id, store_code, store_name, external_store_id, timezone, is_active
           FROM public.stores
           WHERE id = $1 AND is_active = true`,
          [storeId]
        );
        return res.rows[0] ?? null;
      },

      async executeIngestBatchRpc(rpcParams): Promise<IngestBatchRpcResponse> {
        const res = await db.query<{ res: IngestBatchRpcResponse }>(
          `SELECT public.ingest_order_batch(
             $1::UUID,
             $2::UUID,
             $3::TEXT,
             $4::TEXT,
             $5::JSONB,
             $6::BOOLEAN,
             $7::JSONB
           ) AS res`,
          [
            rpcParams.storeId,
            rpcParams.uploadedBy,
            rpcParams.originalFilename,
            rpcParams.fileChecksumSha256,
            JSON.stringify(rpcParams.records),
            rpcParams.forceReprocess,
            JSON.stringify(rpcParams.processingMetadata),
          ]
        );
        return res.rows[0].res;
      },

      async recordFailedBatchRpc(failParams): Promise<string | null> {
        const res = await db.query<{ id: string }>(
          `SELECT public.record_failed_ingestion_batch(
             $1::UUID,
             $2::UUID,
             $3::TEXT,
             $4::TEXT,
             $5::INTEGER,
             $6::INTEGER,
             $7::TEXT,
             $8::JSONB,
             $9::JSONB
           ) AS id`,
          [
            failParams.storeId,
            failParams.uploadedBy,
            failParams.originalFilename,
            failParams.fileChecksumSha256,
            failParams.totalRows,
            failParams.rejectedCount,
            failParams.errorSummary,
            JSON.stringify(failParams.rejectedRows),
            JSON.stringify(failParams.processingMetadata),
          ]
        );
        return res.rows[0]?.id ?? null;
      },
    };
  });

  afterAll(async () => {
    await db.close();
  });

  it('enforces strict CORS origin allowlist and rejects unknown origins', () => {
    const allowed = parseAllowedOrigins(
      'https://suhaasvaddi.github.io, https://urbanconnect.example.com/'
    );
    expect(allowed).toContain('https://suhaasvaddi.github.io');
    expect(allowed).toContain('https://urbanconnect.example.com');
    expect(allowed).toContain('http://localhost:5173');

    const okEval = evaluateCorsOrigin('https://suhaasvaddi.github.io', allowed);
    expect(okEval.allowed).toBe(true);
    expect(okEval.headers['Access-Control-Allow-Origin']).toBe(
      'https://suhaasvaddi.github.io'
    );

    const blockedEval = evaluateCorsOrigin('https://malicious.example.org', allowed);
    expect(blockedEval.allowed).toBe(false);
    expect(blockedEval.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('rejects anonymous and non-administrator requests with 401 and 403', async () => {
    const unauthRes = await handleIngestOrderBatch({
      authHeader: null,
      payload: {},
      adapter,
    });
    expect(unauthRes.status).toBe(401);
    expect(unauthRes.body.code).toBe('UNAUTHORIZED');

    const nonAdminRes = await handleIngestOrderBatch({
      authHeader: 'Bearer valid-non-admin-token',
      payload: {},
      adapter,
    });
    expect(nonAdminRes.status).toBe(403);
    expect(nonAdminRes.body.code).toBe('FORBIDDEN_NOT_ADMIN');
  });

  it('ingests all 963 orders from the reference workbook atomically and verifies database records', async () => {
    const fileBuffer = fs.readFileSync(FIXTURE_PATH);
    const fileBytes = new Uint8Array(fileBuffer);
    const fileChecksum = sha256Bytes(fileBytes);
    const submittedRows = extractRawRowsFromWorkbook(fileBytes);

    expect(submittedRows).toHaveLength(963);

    const res = await handleIngestOrderBatch({
      authHeader: 'Bearer valid-admin-token',
      payload: {
        store_id: tmk7StoreId,
        original_filename: 'Amazon Narhe - Reports-2.xlsx',
        file_size_bytes: fileBytes.byteLength,
        file_checksum_sha256: fileChecksum,
        rows: submittedRows,
      },
      adapter,
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe('Succeeded');
    expect(res.body.already_processed).toBe(false);
    expect(res.body.total_rows).toBe(963);
    expect(res.body.inserted_count).toBe(963);
    expect(res.body.updated_count).toBe(0);
    expect(res.body.unchanged_count).toBe(0);
    expect(res.body.rejected_count).toBe(0);
    expect(res.body.min_order_date).toBe('2026-10-18');
    expect(res.body.max_order_date).toBe('2026-10-18');

    const batchId = res.body.batch_id as string;

    // Verify canonical orders in PostgreSQL
    const countRes = await db.query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt FROM public.orders WHERE store_id = $1`,
      [tmk7StoreId]
    );
    expect(countRes.rows[0].cnt).toBe(963);

    // Verify status distribution in PostgreSQL
    const statusRes = await db.query<{ status: string; cnt: number }>(
      `SELECT status, count(*)::int AS cnt
       FROM public.orders
       WHERE store_id = $1
       GROUP BY status
       ORDER BY cnt DESC`,
      [tmk7StoreId]
    );
    expect(statusRes.rows).toEqual([
      { status: 'COMPLETED', cnt: 955 },
      { status: 'RTO_DELIVERED', cnt: 6 },
      { status: 'CANCELLED', cnt: 2 },
    ]);

    // Verify all 8 non-completed orders have OTP fields set to 'Not Applicable'
    const nonCompletedOtpRes = await db.query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt
       FROM public.orders
       WHERE store_id = $1
         AND status <> 'COMPLETED'
         AND otp_performance = 'Not Applicable'
         AND otp_plus_3_performance = 'Not Applicable'`,
      [tmk7StoreId]
    );
    expect(nonCompletedOtpRes.rows[0].cnt).toBe(8);

    // Verify all 963 batch rows were recorded with action = 'inserted'
    const batchRowsRes = await db.query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt
       FROM public.ingestion_batch_rows
       WHERE batch_id = $1 AND action = 'inserted'`,
      [batchId]
    );
    expect(batchRowsRes.rows[0].cnt).toBe(963);

    // Test file-level duplicate detection when uploading the identical file again
    const dupRes = await handleIngestOrderBatch({
      authHeader: 'Bearer valid-admin-token',
      payload: {
        store_id: tmk7StoreId,
        original_filename: 'Amazon Narhe - Reports-2 (copy).xlsx',
        file_size_bytes: fileBytes.byteLength,
        file_checksum_sha256: fileChecksum,
        rows: submittedRows,
      },
      adapter,
    });

    expect(dupRes.status).toBe(200);
    expect(dupRes.body.already_processed).toBe(true);
    expect(dupRes.body.status).toBe('Duplicate Skipped');
    expect(dupRes.body.prior_batch_id).toBe(batchId);
    expect(dupRes.body.inserted_count).toBe(0);
    expect(dupRes.body.updated_count).toBe(0);
    expect(dupRes.body.unchanged_count).toBe(963);
  });

  it('handles order-level updates, preserves updated_at on unchanged rows, and records revision history', async () => {
    const fileBuffer = fs.readFileSync(FIXTURE_PATH);
    const submittedRows = extractRawRowsFromWorkbook(new Uint8Array(fileBuffer));

    const unchangedOrderId = 'QC_405-2853124-8797901'; // Row 2
    const updatedOrderId = 'QC_402-0807645-9121917'; // Row 3

    const beforeUnchanged = await db.query<{ updated_at: string }>(
      `SELECT updated_at::text FROM public.orders WHERE store_id = $1 AND order_id = $2`,
      [tmk7StoreId, unchangedOrderId]
    );

    // Build a 3-row subsequent upload:
    //   1. Row 2 unchanged
    //   2. Row 3 modified (LM Distance 957 -> 1450; Arrived Delivery At delayed to 00:09:49 -> OTP Breached)
    //   3. Row 4 new Dummy order (AM_DUMMY_TEST_01)
    const row1Unchanged = submittedRows[0];
    const row2Modified: SubmittedWorkbookRow = {
      source_row_number: 3,
      raw_row: {
        ...submittedRows[1].raw_row,
        'LM Distance': 1450,
        'Arrived Delivery At': '2026-10-19 00:09:49',
      },
    };
    const row3NewDummy: SubmittedWorkbookRow = {
      source_row_number: 4,
      raw_row: {
        ...submittedRows[0].raw_row,
        'Order ID': 'AM_DUMMY_TEST_01',
        'LM Distance': 500,
      },
    };

    const res = await handleIngestOrderBatch({
      authHeader: 'Bearer valid-admin-token',
      payload: {
        store_id: tmk7StoreId,
        original_filename: 'Amazon Narhe - Subsequent Update.xlsx',
        file_size_bytes: 4096,
        file_checksum_sha256: 'e'.repeat(64),
        rows: [row1Unchanged, row2Modified, row3NewDummy],
      },
      adapter,
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Succeeded');
    expect(res.body.total_rows).toBe(3);
    expect(res.body.inserted_count).toBe(1);
    expect(res.body.updated_count).toBe(1);
    expect(res.body.unchanged_count).toBe(1);

    // 1. Verify unchanged order's updated_at timestamp was NOT modified
    const afterUnchanged = await db.query<{ updated_at: string }>(
      `SELECT updated_at::text FROM public.orders WHERE store_id = $1 AND order_id = $2`,
      [tmk7StoreId, unchangedOrderId]
    );
    expect(afterUnchanged.rows[0].updated_at).toBe(beforeUnchanged.rows[0].updated_at);

    // 2. Verify updated order's canonical row reflects new source and recalculated derived fields
    const updatedRowRes = await db.query<{
      lm_distance: number;
      distance_meters: number;
      otp_performance: string;
      otp_plus_3_performance: string;
    }>(
      `SELECT lm_distance, distance_meters, otp_performance, otp_plus_3_performance
       FROM public.orders
       WHERE store_id = $1 AND order_id = $2`,
      [tmk7StoreId, updatedOrderId]
    );
    expect(updatedRowRes.rows[0]).toEqual({
      lm_distance: 1450,
      distance_meters: 1450,
      otp_performance: 'OTP Breached',
      otp_plus_3_performance: 'OTP Breached',
    });

    // 3. Verify order_revision_history captured before-and-after snapshots and field diffs
    const revRes = await db.query<{
      action_type: string;
      changed_fields: Record<string, { before: unknown; after: unknown }>;
      previous_derived_snapshot: Record<string, unknown>;
      new_derived_snapshot: Record<string, unknown>;
    }>(
      `SELECT action_type, changed_fields, previous_derived_snapshot, new_derived_snapshot
       FROM public.order_revision_history
       WHERE store_id = $1 AND order_id = $2`,
      [tmk7StoreId, updatedOrderId]
    );
    expect(revRes.rows).toHaveLength(1);
    expect(revRes.rows[0].action_type).toBe('UPDATE');
    expect(revRes.rows[0].changed_fields.lm_distance).toEqual({
      before: 957,
      after: 1450,
    });
    expect(revRes.rows[0].previous_derived_snapshot.otp_performance).toBe('OTP Achieved');
    expect(revRes.rows[0].new_derived_snapshot.otp_performance).toBe('OTP Breached');

    // 4. Verify new AM_ order was classified as Dummy
    const dummyRes = await db.query<{ order_type: string }>(
      `SELECT order_type FROM public.orders WHERE store_id = $1 AND order_id = 'AM_DUMMY_TEST_01'`,
      [tmk7StoreId]
    );
    expect(dummyRes.rows[0].order_type).toBe('Dummy');
  });

  it('rejects batches with invalid rows atomically (422), logs Failed batch audit, and allows retry after fix', async () => {
    const fileBuffer = fs.readFileSync(FIXTURE_PATH);
    const submittedRows = extractRawRowsFromWorkbook(new Uint8Array(fileBuffer));

    const brokenChecksum = 'f'.repeat(64);
    const brokenRow: SubmittedWorkbookRow = {
      source_row_number: 2,
      raw_row: {
        ...submittedRows[0].raw_row,
        'Order ID': 'QC_BROKEN_ROW_01',
        'Arrived Delivery At': null, // Invalid for COMPLETED order
      },
    };

    const failRes = await handleIngestOrderBatch({
      authHeader: 'Bearer valid-admin-token',
      payload: {
        store_id: tmk7StoreId,
        original_filename: 'Broken Upload.xlsx',
        file_size_bytes: 2048,
        file_checksum_sha256: brokenChecksum,
        rows: [brokenRow],
      },
      adapter,
    });

    expect(failRes.status).toBe(422);
    expect(failRes.body.code).toBe('VALIDATION_FAILED');
    expect(failRes.body.status).toBe('Failed');
    expect(failRes.body.rejected_count).toBe(1);
    expect(failRes.body.batch_id).toBeTruthy();

    // Verify QC_BROKEN_ROW_01 was NOT written to public.orders
    const checkBroken = await db.query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt FROM public.orders WHERE order_id = 'QC_BROKEN_ROW_01'`
    );
    expect(checkBroken.rows[0].cnt).toBe(0);

    // Verify failed batch was recorded and remains recoverable if retried with valid data
    const fixedRow: SubmittedWorkbookRow = {
      source_row_number: 2,
      raw_row: {
        ...submittedRows[0].raw_row,
        'Order ID': 'QC_BROKEN_ROW_01',
      },
    };

    const retryRes = await handleIngestOrderBatch({
      authHeader: 'Bearer valid-admin-token',
      payload: {
        store_id: tmk7StoreId,
        original_filename: 'Broken Upload Fixed.xlsx',
        file_size_bytes: 2048,
        file_checksum_sha256: brokenChecksum,
        rows: [fixedRow],
      },
      adapter,
    });

    expect(retryRes.status).toBe(200);
    expect(retryRes.body.status).toBe('Succeeded');
    expect(retryRes.body.inserted_count).toBe(1);
  });
});
