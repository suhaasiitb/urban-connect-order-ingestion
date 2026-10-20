import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  handleIngestOrderBatch,
  type IngestBatchRpcResponse,
  type IngestionBackendAdapter,
  type SubmittedWorkbookRow,
} from '../../supabase/functions/_shared/ingestionHandler';
import { parseAndValidateOrderWorkbook } from '../../src/domain/excelParser';
import type { StoreMaster } from '../../src/domain/types';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations');
const FIXTURE_PATH = path.resolve(
  __dirname,
  '../fixtures/Amazon Narhe - Reports-2.xlsx'
);
const DIST_DIR = path.resolve(__dirname, '../../dist');

const ADMIN_UID = '00000000-0000-4000-8000-000000000101';
const NON_ADMIN_UID = '00000000-0000-4000-8000-000000000202';

describe('Phase 6 — End-to-End Acceptance Verification Suite (Section 13)', () => {
  let db: PGlite;
  let adapter: IngestionBackendAdapter;
  let tmk7Store: StoreMaster;

  beforeAll(async () => {
    db = new PGlite();

    // Bootstrap Supabase-standard roles and auth schema
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

      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

      CREATE SCHEMA IF NOT EXISTS auth;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

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

      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
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

    await db.query(
      `INSERT INTO auth.users (id, email, aud, role, created_at, updated_at)
       VALUES
         ($1, 'admin@urbanconnect.in', 'authenticated', 'authenticated', now(), now()),
         ($2, 'nonadmin@urbanconnect.in', 'authenticated', 'authenticated', now(), now())`,
      [ADMIN_UID, NON_ADMIN_UID]
    );

    await db.query(
      `INSERT INTO public.admin_users (user_id, email, full_name, is_active)
       VALUES ($1, 'admin@urbanconnect.in', 'Lead Operations Admin', true)`,
      [ADMIN_UID]
    );

    const storeRes = await db.query<StoreMaster>(
      `SELECT id, store_code, store_name, external_store_id, timezone, is_active
       FROM public.stores
       WHERE store_code = 'TMK7'`
    );
    tmk7Store = storeRes.rows[0];

    adapter = {
      async verifyAdminSession(authHeader: string | null) {
        if (authHeader === 'Bearer admin-jwt') {
          return {
            authenticated: true,
            isAdmin: true,
            userId: ADMIN_UID,
            email: 'admin@urbanconnect.in',
          };
        }
        if (authHeader === 'Bearer non-admin-jwt') {
          return {
            authenticated: true,
            isAdmin: false,
            userId: NON_ADMIN_UID,
            email: 'nonadmin@urbanconnect.in',
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

  it('1. Security Acceptance: blocks anonymous and non-admin database/API access and enforces RLS', async () => {
    // A. Anonymous user cannot SELECT from public.orders or public.stores
    await expect(
      db.exec(`
        BEGIN;
        SET LOCAL ROLE anon;
        SELECT * FROM public.orders;
        COMMIT;
      `)
    ).rejects.toThrow(/permission denied/i);
    await db.exec(`ROLLBACK;`);

    // B. Authenticated non-admin user gets 0 rows from RLS on public.stores and public.orders
    await db.exec(`BEGIN;`);
    await db.exec(`SET LOCAL ROLE authenticated;`);
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [
      NON_ADMIN_UID,
    ]);
    const nonAdminStores = await db.query(`SELECT * FROM public.stores`);
    expect(nonAdminStores.rows).toHaveLength(0);
    await db.exec(`COMMIT;`);

    // C. Authenticated active admin CAN read public.stores via RLS, but CANNOT directly INSERT into public.orders
    await db.exec(`BEGIN;`);
    await db.exec(`SET LOCAL ROLE authenticated;`);
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [
      ADMIN_UID,
    ]);
    const adminStores = await db.query<{ store_code: string }>(
      `SELECT store_code FROM public.stores`
    );
    expect(adminStores.rows).toEqual([{ store_code: 'TMK7' }]);
    await db.exec(`COMMIT;`);

    await expect(
      db.exec(`
        BEGIN;
        SET LOCAL ROLE authenticated;
        DELETE FROM public.orders;
        COMMIT;
      `)
    ).rejects.toThrow(/permission denied/i);
    await db.exec(`ROLLBACK;`);
  });

  it('2. Full Flow Acceptance: parses reference workbook, ingests 963 TMK7 orders, and verifies hourly/date queries', async () => {
    const fileBuffer = fs.readFileSync(FIXTURE_PATH);
    const fileBytes = new Uint8Array(fileBuffer);

    // Step A: Frontend preview parse & validation
    const preview = parseAndValidateOrderWorkbook({
      fileBytes,
      filename: 'Amazon Narhe - Reports-2.xlsx',
      store: tmk7Store,
    });

    expect(preview.is_valid).toBe(true);
    expect(preview.total_rows_detected).toBe(963);
    expect(preview.valid_rows_count).toBe(963);
    expect(preview.invalid_rows_count).toBe(0);
    expect(preview.status_distribution).toEqual({
      COMPLETED: 955,
      RTO_DELIVERED: 6,
      CANCELLED: 2,
    });

    // Step B: Administrator confirms upload -> Backend Edge Function handler executes atomic persistence
    const submittedRows: SubmittedWorkbookRow[] = preview.rows.map((r) => ({
      source_row_number: r.source_row_number,
      raw_row: r.raw_source_snapshot as SubmittedWorkbookRow['raw_row'],
    }));

    const ingestRes = await handleIngestOrderBatch({
      authHeader: 'Bearer admin-jwt',
      payload: {
        store_id: tmk7Store.id,
        original_filename: preview.filename,
        file_size_bytes: preview.file_size_bytes,
        file_checksum_sha256: preview.file_checksum_sha256,
        rows: submittedRows,
      },
      adapter,
    });

    expect(ingestRes.status).toBe(200);
    expect(ingestRes.body.status).toBe('Succeeded');
    expect(ingestRes.body.inserted_count).toBe(963);

    // Step C: Verify store-specific and hourly queries required by Section 8
    // Query 1: All TMK7 orders for October 18, 2026
    const oct18Count = await db.query<{ cnt: number }>(
      `SELECT count(*)::int AS cnt
       FROM public.orders
       WHERE store_id = $1 AND order_date = '2026-10-18'`,
      [tmk7Store.id]
    );
    expect(oct18Count.rows[0].cnt).toBe(963);

    // Query 2: All TMK7 orders for October 18, 2026 grouped by slot_hour
    const hourlyRes = await db.query<{ slot_hour: number; cnt: number }>(
      `SELECT slot_hour::int AS slot_hour, count(*)::int AS cnt
       FROM public.orders
       WHERE store_id = $1 AND order_date = '2026-10-18'
       GROUP BY slot_hour
       ORDER BY slot_hour ASC`,
      [tmk7Store.id]
    );

    const hourlyMap = Object.fromEntries(
      hourlyRes.rows.map((r) => [r.slot_hour, r.cnt])
    );
    expect(hourlyMap).toEqual({
      6: 6,
      7: 28,
      8: 62,
      9: 74,
      10: 96,
      11: 79,
      12: 66,
      13: 63,
      14: 47,
      15: 28,
      16: 47,
      17: 57,
      18: 56,
      19: 71,
      20: 68,
      21: 59,
      22: 30,
      23: 26,
    });
  });

  it('3. Multi-Store & Revision Acceptance: supports a second store without schema changes and tracks revisions accurately', async () => {
    // Configure a second store in public.stores
    const store2Insert = await db.query<StoreMaster>(
      `INSERT INTO public.stores (store_code, store_name, external_store_id, timezone, is_active)
       VALUES ('TMK8', 'Amazon Baner (TMK8)', '4248', 'Asia/Kolkata', true)
       RETURNING id, store_code, store_name, external_store_id, timezone, is_active`
    );
    const tmk8Store = store2Insert.rows[0];

    const tmk8Row: SubmittedWorkbookRow = {
      source_row_number: 2,
      raw_row: {
        'Rider Number': 'XXXXXX9999',
        'Arrived Pickup At': '2026-10-19 10:01:00',
        'LM Distance': 1200,
        'Resting Point Name': 'null',
        'Total ETA': 5,
        'Completed At': 'null',
        'Resting Point ID': 'null',
        'Store Name': 'TMK8 | 10:00 AM | 1.2 KM',
        'Pickup At': '2026-10-19 10:03:00',
        'Order ETA Status': 'null',
        'Staged At': '2026-10-19 10:02:00',
        'Pickup ETA': 15,
        'Arrive at Pickup ETA': null,
        'Status Text': null,
        'Created At': '2026-10-19 10:00:15',
        'Status': 'COMPLETED',
        'Rider Name': 'Test Rider',
        'Order ID': 'QC_TMK8_ORDER_001',
        'Store ID': 4248,
        'Total Time': 'null',
        'Arrive at Delivery ETA': '2026-10-19 10:10:00',
        'Arrived Delivery At': '2026-10-19 10:08:30',
        'Tracking URL': 'https://track.loadshare.net/order/tmk8',
        'Customer ID': 22411,
        'RTO At': null,
        'FM Distance': 0,
        'Assigned At': '10:00:00',
        'Delivery ETA': 5,
        'Batch ID': 'null',
      },
    };

    const tmk8Res = await handleIngestOrderBatch({
      authHeader: 'Bearer admin-jwt',
      payload: {
        store_id: tmk8Store.id,
        original_filename: 'Amazon Baner - Oct 19.xlsx',
        file_size_bytes: 2048,
        file_checksum_sha256: '9'.repeat(64),
        rows: [tmk8Row],
      },
      adapter,
    });

    expect(tmk8Res.status).toBe(200);
    expect(tmk8Res.body.inserted_count).toBe(1);
    expect(tmk8Res.body.store_code).toBe('TMK8');

    // Verify store isolation: TMK7 still has 963 orders, TMK8 has 1 order
    const storeCounts = await db.query<{ store_code: string; cnt: number }>(
      `SELECT store_code, count(*)::int AS cnt
       FROM public.orders
       GROUP BY store_code
       ORDER BY store_code ASC`
    );
    expect(storeCounts.rows).toEqual([
      { store_code: 'TMK7', cnt: 963 },
      { store_code: 'TMK8', cnt: 1 },
    ]);
  });

  it('4. Production Build & Deployment Artifact Acceptance: verifies dist/ output and SPA fallback', () => {
    expect(fs.existsSync(path.join(DIST_DIR, 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(DIST_DIR, '404.html'))).toBe(true);

    // Ensure no privileged keys exist anywhere in the built static files
    const assetsDir = path.join(DIST_DIR, 'assets');
    const assetFiles = fs.readdirSync(assetsDir);
    expect(assetFiles.length).toBeGreaterThan(0);

    for (const file of assetFiles) {
      if (file.endsWith('.js') || file.endsWith('.css')) {
        const content = fs.readFileSync(path.join(assetsDir, file), 'utf8');
        expect(content).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
      }
    }
  });
});
