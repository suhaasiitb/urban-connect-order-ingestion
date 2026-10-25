import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations');

const ADMIN_USER_ID = '00000000-0000-4000-8000-000000000001';
const TMK7_USER_ID = '00000000-0000-4000-8000-000000000002';
const TMB1_USER_ID = '00000000-0000-4000-8000-000000000003';
const UNAUTH_USER_ID = '00000000-0000-4000-8000-000000000004';

describe('Store Users & Store Scoping Verification (PGlite)', () => {
  let db: PGlite;
  let tmk7StoreId: string;
  let tmb1StoreId: string;

  beforeAll(async () => {
    db = new PGlite();

    // 1. Setup Postgres roles and Supabase auth mock
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
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS UUID
      LANGUAGE sql
      STABLE
      AS $func$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
      $func$;
    `);

    // 2. Apply all migrations in order
    const migrationFiles = [
      '20261019000001_core_schema.sql',
      '20261019000002_rls_and_grants.sql',
      '20261019000003_ingest_batch_rpc.sql',
      '20261020000001_rider_performance_rpc.sql',
      '20261021000001_active_riders_schema.sql',
      '20261023000001_rider_shifts_schema.sql',
      '20261024000001_new_rider_onboarding.sql',
      '20261024000002_store_users_and_scoping.sql',
    ];

    for (const file of migrationFiles) {
      let sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      sql = sql.replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/gi, '');
      await db.exec(sql);
    }

    // 3. Seed additional store TMB1 for multi-store testing
    await db.exec(`
      INSERT INTO public.stores (store_code, store_name, external_store_id, timezone, is_active)
      VALUES ('TMB1', 'Amazon Baner (TMB1)', '4299', 'Asia/Kolkata', true)
      ON CONFLICT (store_code) DO NOTHING;
    `);

    const storesRes = await db.query<{ id: string; store_code: string }>(
      `SELECT id, store_code FROM public.stores ORDER BY store_code`
    );
    tmk7StoreId = storesRes.rows.find((r) => r.store_code === 'TMK7')!.id;
    tmb1StoreId = storesRes.rows.find((r) => r.store_code === 'TMB1')!.id;

    // 4. Seed Auth Users
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${ADMIN_USER_ID}', 'admin@urbanconnect.in'),
        ('${TMK7_USER_ID}', 'tmk7.lead@urbanconnect.in'),
        ('${TMB1_USER_ID}', 'tmb1.lead@urbanconnect.in'),
        ('${UNAUTH_USER_ID}', 'unauthorized@urbanconnect.in')
      ON CONFLICT (id) DO NOTHING;
    `);

    // 5. Seed Roles: Admin in admin_users, store users in store_users
    await db.exec(`
      INSERT INTO public.admin_users (user_id, email, full_name, is_active)
      VALUES ('${ADMIN_USER_ID}', 'admin@urbanconnect.in', 'Master Admin', true)
      ON CONFLICT (user_id) DO NOTHING;

      INSERT INTO public.store_users (user_id, store_id, email, full_name, is_active)
      VALUES
        ('${TMK7_USER_ID}', '${tmk7StoreId}', 'tmk7.lead@urbanconnect.in', 'TMK7 Manager', true),
        ('${TMB1_USER_ID}', '${tmb1StoreId}', 'tmb1.lead@urbanconnect.in', 'TMB1 Manager', true)
      ON CONFLICT (user_id) DO NOTHING;
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  it('verifies helper functions: get_user_assigned_store_id and has_store_access', async () => {
    // A. Under Admin session
    await db.exec(`SET request.jwt.claim.sub = '${ADMIN_USER_ID}';`);
    const adminAccessTmk7 = await db.query<{ has_access: boolean }>(
      `SELECT public.has_store_access('${tmk7StoreId}'::uuid) as has_access`
    );
    const adminAccessTmb1 = await db.query<{ has_access: boolean }>(
      `SELECT public.has_store_access('${tmb1StoreId}'::uuid) as has_access`
    );
    expect(adminAccessTmk7.rows[0].has_access).toBe(true);
    expect(adminAccessTmb1.rows[0].has_access).toBe(true);

    // B. Under TMK7 Store User session
    await db.exec(`SET request.jwt.claim.sub = '${TMK7_USER_ID}';`);
    const tmk7AssignedStore = await db.query<{ store_id: string }>(
      `SELECT public.get_user_assigned_store_id() as store_id`
    );
    expect(tmk7AssignedStore.rows[0].store_id).toBe(tmk7StoreId);

    const tmk7AccessTmk7 = await db.query<{ has_access: boolean }>(
      `SELECT public.has_store_access('${tmk7StoreId}'::uuid) as has_access`
    );
    const tmk7AccessTmb1 = await db.query<{ has_access: boolean }>(
      `SELECT public.has_store_access('${tmb1StoreId}'::uuid) as has_access`
    );
    expect(tmk7AccessTmk7.rows[0].has_access).toBe(true);
    expect(tmk7AccessTmb1.rows[0].has_access).toBe(false); // Scoped out of TMB1!

    // C. Under Unauthorized user session
    await db.exec(`SET request.jwt.claim.sub = '${UNAUTH_USER_ID}';`);
    const unauthAssignedStore = await db.query<{ store_id: string }>(
      `SELECT public.get_user_assigned_store_id() as store_id`
    );
    expect(unauthAssignedStore.rows[0].store_id).toBeNull();

    const unauthAccess = await db.query<{ has_access: boolean }>(
      `SELECT public.has_store_access('${tmk7StoreId}'::uuid) as has_access`
    );
    expect(unauthAccess.rows[0].has_access).toBe(false);
  });

  it('enforces RLS on public.stores: admin sees all stores, store user sees only assigned store', async () => {
    // Switch to authenticated role
    await db.exec(`SET ROLE authenticated;`);

    // A. Admin sees both stores
    await db.exec(`SET request.jwt.claim.sub = '${ADMIN_USER_ID}';`);
    const adminStores = await db.query<{ store_code: string }>(
      `SELECT store_code FROM public.stores ORDER BY store_code`
    );
    expect(adminStores.rows.map((r) => r.store_code)).toEqual(['TMB1', 'TMK7']);

    // B. TMK7 User sees ONLY TMK7
    await db.exec(`SET request.jwt.claim.sub = '${TMK7_USER_ID}';`);
    const tmk7Stores = await db.query<{ store_code: string }>(
      `SELECT store_code FROM public.stores ORDER BY store_code`
    );
    expect(tmk7Stores.rows.map((r) => r.store_code)).toEqual(['TMK7']);

    // C. TMB1 User sees ONLY TMB1
    await db.exec(`SET request.jwt.claim.sub = '${TMB1_USER_ID}';`);
    const tmb1Stores = await db.query<{ store_code: string }>(
      `SELECT store_code FROM public.stores ORDER BY store_code`
    );
    expect(tmb1Stores.rows.map((r) => r.store_code)).toEqual(['TMB1']);

    // D. Unauthorized user sees NO stores
    await db.exec(`SET request.jwt.claim.sub = '${UNAUTH_USER_ID}';`);
    const unauthStores = await db.query<{ store_code: string }>(
      `SELECT store_code FROM public.stores ORDER BY store_code`
    );
    expect(unauthStores.rows).toHaveLength(0);

    // Reset role
    await db.exec(`RESET ROLE;`);
  });

  it('allows store user to ingest orders for their assigned store, but rejects ingestion for other stores', async () => {
    const sampleRecord = [
      {
        source_row_number: 2,
        source_row_hash: 'a1b2c3d4e5f60000000000000000000000000000000000000000000000000001',
        raw_source_snapshot: { 'Order ID': 'TEST-ORD-001', 'Store': 'TMK7' },
        normalized_source: {
          order_id: 'TEST-ORD-001',
          rider_number: '9876543210',
          rider_name: 'Rahul Kumar',
          source_store_name: 'Amazon Narhe (TMK7)',
          external_store_id: '4247',
          order_created_at: '2026-10-24T09:00:00Z',
          status: 'DELIVERED',
        },
        derived_fields: {
          order_type: 'Actual',
          store_code: 'TMK7',
          slot_hour: 9,
          order_date: '2026-10-24',
          staging_to_pickup_minutes: 12.5,
          s2p_minutes: 12.5,
          distance_meters: 1200,
          actual_arrival_minutes: 10.2,
          arrival_eta_minutes: 15.0,
          otp_performance: 'OTP Achieved',
          otp_plus_3_performance: 'OTP Achieved',
        },
      },
    ];

    // A. TMK7 store user ingests for TMK7 -> SUCCESS
    const successRes = await db.query<{ res: { ok: boolean; status: string } }>(
      `SELECT public.ingest_order_batch(
        $1::uuid,
        $2::uuid,
        'tmk7_orders_test.xlsx',
        '1111111111111111111111111111111111111111111111111111111111111111',
        $3::jsonb
      ) as res`,
      [tmk7StoreId, TMK7_USER_ID, JSON.stringify(sampleRecord)]
    );
    expect(successRes.rows[0].res.status).toBe('Succeeded');

    // B. TMK7 store user attempts to ingest for TMB1 -> REJECTED with 42501 Unauthorized
    await expect(
      db.query(
        `SELECT public.ingest_order_batch(
          $1::uuid,
          $2::uuid,
          'tmb1_orders_hack.xlsx',
          '2222222222222222222222222222222222222222222222222222222222222222',
          $3::jsonb
        )`,
        [tmb1StoreId, TMK7_USER_ID, JSON.stringify(sampleRecord)]
      )
    ).rejects.toThrow(/Unauthorized: user .* is not authorized to ingest orders for store/);

    // C. Unauthorized user attempts ingestion -> REJECTED
    await expect(
      db.query(
        `SELECT public.ingest_order_batch(
          $1::uuid,
          $2::uuid,
          'unauth.xlsx',
          '3333333333333333333333333333333333333333333333333333333333333333',
          $3::jsonb
        )`,
        [tmk7StoreId, UNAUTH_USER_ID, JSON.stringify(sampleRecord)]
      )
    ).rejects.toThrow(/Unauthorized/);
  });

  it('allows admin to register and link a store user via register_store_user RPC', async () => {
    // Admin links unauth user to TMB1
    await db.exec(`SET request.jwt.claim.sub = '${ADMIN_USER_ID}';`);
    const linkRes = await db.query<{ res: { ok: boolean; store_code: string; email: string } }>(
      `SELECT public.register_store_user(
        'unauthorized@urbanconnect.in',
        'TMB1',
        'New Baner Operator'
      ) as res`
    );
    expect(linkRes.rows[0].res.ok).toBe(true);
    expect(linkRes.rows[0].res.store_code).toBe('TMB1');

    // Verify unauth user now has access to TMB1
    await db.exec(`SET request.jwt.claim.sub = '${UNAUTH_USER_ID}';`);
    const newAccess = await db.query<{ has_access: boolean }>(
      `SELECT public.has_store_access('${tmb1StoreId}'::uuid) as has_access`
    );
    expect(newAccess.rows[0].has_access).toBe(true);

    // But still cannot access TMK7
    const noAccessTmk7 = await db.query<{ has_access: boolean }>(
      `SELECT public.has_store_access('${tmk7StoreId}'::uuid) as has_access`
    );
    expect(noAccessTmk7.rows[0].has_access).toBe(false);
  });

  it('enforces store scoping on store_rider_shifts upserts and queries', async () => {
    // 1. TMK7 operator can upsert shifts for their store
    await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${TMK7_USER_ID}';`);
    await db.query(`
      INSERT INTO public.store_rider_shifts (
        store_id, rider_name, normalized_name, shift_type, slot1_start_hour, slot1_end_hour, total_planned_hours, joining_date
      ) VALUES (
        '${tmk7StoreId}', 'Amit Sharma', 'amit sharma', 'Morning Shift', 6, 14, 8.0, '2026-10-10'
      )
      ON CONFLICT (store_id, normalized_name) DO UPDATE
      SET shift_type = EXCLUDED.shift_type,
          joining_date = EXCLUDED.joining_date;
    `);

    // Verify TMK7 operator can read the shift
    const tmk7Shifts = await db.query<{ rider_name: string; joining_date: string }>(
      `SELECT rider_name, joining_date::text FROM public.store_rider_shifts WHERE store_id = '${tmk7StoreId}'`
    );
    expect(tmk7Shifts.rows.length).toBe(1);
    expect(tmk7Shifts.rows[0].rider_name).toBe('Amit Sharma');

    // 2. TMK7 operator cannot insert shifts for TMB1 (RLS violation)
    await expect(
      db.query(`
        INSERT INTO public.store_rider_shifts (
          store_id, rider_name, normalized_name, shift_type, slot1_start_hour, slot1_end_hour, total_planned_hours
        ) VALUES (
          '${tmb1StoreId}', 'Hacked Rider', 'hacked rider', 'Morning Shift', 6, 14, 8.0
        )
      `)
    ).rejects.toThrow(/violates row-level security policy/);

    // 3. TMK7 operator cannot view TMB1 shifts (returns 0 rows under RLS)
    const tmb1Shifts = await db.query(
      `SELECT * FROM public.store_rider_shifts WHERE store_id = '${tmb1StoreId}'`
    );
    expect(tmb1Shifts.rows.length).toBe(0);

    // 4. Admin can see shifts across all stores
    await db.exec(`SET request.jwt.claim.sub = '${ADMIN_USER_ID}';`);
    const allShifts = await db.query(
      `SELECT rider_name FROM public.store_rider_shifts`
    );
    expect(allShifts.rows.length).toBe(1);

    await db.exec(`RESET ROLE;`);
  });

  it('enforces store scoping on active riders roster management', async () => {
    // 1. TMK7 operator can insert into store_active_riders and store_rider_roster_uploads
    await db.exec(`SET ROLE authenticated; SET request.jwt.claim.sub = '${TMK7_USER_ID}';`);
    await db.query(`
      INSERT INTO public.store_active_riders (
        store_id, rider_name, normalized_name, phone, online_status
      ) VALUES (
        '${tmk7StoreId}', 'Suresh Patil', 'suresh patil', '9999988888', 'Active'
      );
    `);
    await db.query(`
      INSERT INTO public.store_rider_roster_uploads (
        store_id, filename, total_riders, uploaded_by
      ) VALUES (
        '${tmk7StoreId}', 'tmk7_roster.xlsx', 1, 'tmk7.lead@urbanconnect.in'
      );
    `);

    // Verify select
    const riders = await db.query(
      `SELECT rider_name FROM public.store_active_riders WHERE store_id = '${tmk7StoreId}'`
    );
    expect(riders.rows.length).toBe(1);

    // 2. TMK7 operator cannot insert active riders for TMB1
    await expect(
      db.query(`
        INSERT INTO public.store_active_riders (
          store_id, rider_name, normalized_name
        ) VALUES (
          '${tmb1StoreId}', 'Unauthorized Rider', 'unauthorized rider'
        );
      `)
    ).rejects.toThrow(/violates row-level security policy/);

    // 3. TMK7 operator can delete their own store's active riders (for roster re-upload)
    await db.query(`
      DELETE FROM public.store_active_riders WHERE store_id = '${tmk7StoreId}'
    `);
    const remaining = await db.query(
      `SELECT rider_name FROM public.store_active_riders WHERE store_id = '${tmk7StoreId}'`
    );
    expect(remaining.rows.length).toBe(0);

    await db.exec(`RESET ROLE;`);
  });
});
