import * as fs from 'node:fs';
import * as path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations');
const VERIFY_SQL_PATH = path.resolve(__dirname, '../../supabase/tests/verify_schema.sql');

describe('PostgreSQL Schema, RLS, Grants & Atomic RPC Verification (PGlite)', () => {
  it('applies all 3 migrations and passes the full transactional verify_schema.sql suite on real PostgreSQL', async () => {
    const db = new PGlite();

    // Bootstrap Supabase-standard roles and auth schema required by migrations
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

    const m1 = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20261019000001_core_schema.sql'),
      'utf8'
    );
    const m2 = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20261019000002_rls_and_grants.sql'),
      'utf8'
    );
    const m3 = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20261019000003_ingest_batch_rpc.sql'),
      'utf8'
    );
    const verifySql = fs.readFileSync(VERIFY_SQL_PATH, 'utf8');

    // Note: PGlite runs in single-user mode where pgcrypto's gen_random_uuid()
    // is built into Postgres 13+ core, so we strip "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
    // if pgcrypto contrib is not bundled in base WASM.
    const m1Clean = m1.replace(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/gi, '');

    await db.exec(m1Clean);
    await db.exec(m2);
    await db.exec(m3);
    await db.exec(verifySql);

    // Confirm TMK7 store seed is present and active after verifySql rolled back its test data
    const storeRes = await db.query<{ store_code: string; external_store_id: string }>(
      `SELECT store_code, external_store_id FROM public.stores WHERE store_code = 'TMK7'`
    );
    expect(storeRes.rows).toEqual([
      { store_code: 'TMK7', external_store_id: '4247' },
    ]);

    // Apply Planning & SNOP Migration on real PostgreSQL (PGlite)
    const mPlanning = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20261028000002_planning_snop_schema.sql'),
      'utf8'
    );
    await db.exec(mPlanning);

    // Verify store_planning_config table seed
    const dphRes = await db.query<{ site_code: string; target_dph: number }>(
      `SELECT site_code, target_dph FROM public.store_planning_config WHERE site_code = 'TMK7'`
    );
    expect(dphRes.rows).toHaveLength(1);
    expect(Number(dphRes.rows[0].target_dph)).toBe(2.1);

    // Verify 504 rows seeded into store_snop_forecast
    const countRes = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.store_snop_forecast WHERE warehouse_id = 'TMK7'`
    );
    expect(countRes.rows[0].count).toBe('504');

    // Apply Attendance & Planning History / Audit Snapshots migrations on real PostgreSQL (PGlite)
    const mAttendance = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20261031000002_rider_attendance_schema.sql'),
      'utf8'
    );
    await db.exec(mAttendance);

    // Insert 2 historical attendance dates for TMK7 before applying backfill migration
    await db.exec(`
      INSERT INTO public.store_rider_attendance (warehouse_id, attendance_date, rider_name, normalized_name, attendance_status, is_present)
      VALUES
        ('TMK7', '2026-11-04', 'Rider A', 'rider a', 'present', true),
        ('TMK7', '2026-11-04', 'Rider B', 'rider b', 'absent', false),
        ('TMK7', '2026-11-10', 'Rider A', 'rider a', 'present', true);
    `);

    const mHistory = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20261127000001_planning_history_and_audit_snapshots.sql'),
      'utf8'
    );
    await db.exec(mHistory);

    // Verify per-date Target DPH backfill populated both historical dates
    const dailyDphRes = await db.query<{ planning_date: string; target_dph: string }>(
      `SELECT planning_date::text, target_dph::text FROM public.store_planning_daily_config WHERE site_code = 'TMK7' ORDER BY planning_date ASC`
    );
    expect(dailyDphRes.rows).toEqual([
      { planning_date: '2026-11-04', target_dph: '2.10' },
      { planning_date: '2026-11-10', target_dph: '2.10' },
    ]);

    // Verify get_store_attendance_dates RPC returns distinct dates descending
    const datesRpcRes = await db.query<{ attendance_date: string }>(
      `SELECT attendance_date::text FROM public.get_store_attendance_dates('TMK7')`
    );
    expect(datesRpcRes.rows.map((r) => r.attendance_date)).toEqual(['2026-11-10', '2026-11-04']);

    // Verify plan_vs_actual_audit_snapshots accepts and returns snapshot payloads
    const tmk7IdRes = await db.query<{ id: string }>(
      `SELECT id::text FROM public.stores WHERE store_code = 'TMK7'`
    );
    const tmk7Id = tmk7IdRes.rows[0].id;
    await db.query(
      `INSERT INTO public.plan_vs_actual_audit_snapshots (
        store_id, warehouse_id, audit_date, total_orders_count, planned_present_count,
        planned_worked_count, actual_worked_count, turn_up_rate_pct, has_order_data, has_attendance_data,
        hourly_slots, riders
      ) VALUES ($1, 'TMK7', '2026-11-04', 420, 40, 36, 41, 90, true, true, '[]'::jsonb, '[]'::jsonb)`,
      [tmk7Id]
    );
    const snapRes = await db.query<{ turn_up_rate_pct: number; planned_worked_count: number }>(
      `SELECT turn_up_rate_pct, planned_worked_count FROM public.plan_vs_actual_audit_snapshots WHERE store_id = $1 AND audit_date = '2026-11-04'`,
      [tmk7Id]
    );
    expect(snapRes.rows).toEqual([{ turn_up_rate_pct: 90, planned_worked_count: 36 }]);

    await db.close();
  });
});
