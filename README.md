# Urban Connect — Daily Store Order Ingestion Portal

A secure, multi-store daily Excel order-ingestion portal built with **React**, **TypeScript**, **Vite**, **SheetJS**, **Supabase (Auth, PostgreSQL, Edge Functions)**, **GitHub Pages**, and **GitHub Actions**.

---

## 1. Architecture & Business Rules Overview

- **Multi-Store Design**: One shared, indexed `public.orders` table keyed by `UNIQUE (store_id, order_id)` supporting `TMK7` (`Store ID: 4247`) and any additional stores configured in `public.stores`.
- **Worksheet Ingestion Policy**: Production ingestion reads **only** the `Raw Data` worksheet using header-name mapping (never hardcoded column positions) and stores all **29 source fields** plus all **11 calculated fields (`AD–AN`)**.
- **Authoritative Backend Calculation**:
  - Frontend parses and previews the workbook immediately in the browser.
  - When confirmed by an authorized administrator, the Supabase Edge Function (`ingest-orders`) independently re-normalizes the 29 source columns, re-validates all schema/business rules, recalculates all 11 derived columns (`AD–AN`) in `Asia/Kolkata` (`UTC+05:30`) using **Exact Second Precision**, and executes an atomic PostgreSQL transaction (`public.ingest_order_batch`).
- **Fixed Business Decisions**:
  - **Store selection**: One file per store; verified against source `Store Name` prefix and `Store ID`.
  - **Duplicate files**: Detected via `(store_id, file_checksum_sha256)` (`Duplicate Skipped` without creating duplicate orders).
  - **Duplicate / updated orders**: Unchanged orders leave `orders.updated_at` untouched; changed orders update `public.orders` and archive before/after snapshots in `public.order_revision_history`.
  - **Non-completed orders**: Both `otp_performance` (`AM`) and `otp_plus_3_performance` (`AN`) are set to `Not Applicable`.
  - **Validation policy**: Strict All-or-Nothing — any blocking file or row error prevents database writes to `public.orders`.

---

## 2. Beginner-Friendly Setup Guide

### Step 1: VS Code Setup & Local Development

1. Open `/Users/suhaasvaddi/Documents/VS_Code/Amazon` in **VS Code**.
2. Install recommended VS Code extensions when prompted (`.vscode/extensions.json`: ESLint, Prettier, Vitest Explorer).
3. Open the integrated terminal (`Ctrl + ~` or `Cmd + J`) and install dependencies:
   ```bash
   npm install
   ```
4. Create your local environment file from the template:
   ```bash
   cp .env.example .env.local
   ```
5. Run the automated verification checks at any time:
   ```bash
   npm run lint        # ESLint code quality check
   npm run typecheck   # TypeScript compiler check
   npm test            # 29 automated unit, live PostgreSQL (PGlite) & 963-row regression tests
   npm run dev         # Start local Vite development server at http://localhost:5173
   ```

---

### Step 2: Supabase Project Setup

1. Go to [https://supabase.com/dashboard](https://supabase.com/dashboard) and click **New project**.
2. Name the project `urban-connect-order-ingestion`, set a strong database password (save it securely), and choose your closest region (e.g., **South Asia (Mumbai)**).
3. Once the project is ready, go to **Project Settings → API** and copy:
   - **Project URL** → paste into `.env.local` as `VITE_SUPABASE_URL`
   - **Project API Keys → `anon` `public` (or publishable key)** → paste into `.env.local` as `VITE_SUPABASE_ANON_KEY`
   - *(Never put the `service_role` secret key into `.env.local` or any frontend file!)*

---

### Step 3: Applying & Verifying SQL Migrations

You can apply the 3 version-controlled migrations in `supabase/migrations/` using either the **Supabase CLI** or the **Supabase SQL Editor**:

#### Option A — Using Supabase CLI (Recommended)
```bash
# 1. Log in to Supabase CLI
supabase login

# 2. Link your local repository to your Supabase project
#    (Find your 20-character project ref under Project Settings -> General)
supabase link --project-ref <your-project-ref>

# 3. Push the 3 SQL migrations to your remote Supabase PostgreSQL database
supabase db push
```

#### Option B — Using Supabase Dashboard SQL Editor
Open **SQL Editor → New query** in your Supabase Dashboard and run these 3 files in order:
1. `supabase/migrations/20261019000001_core_schema.sql`
2. `supabase/migrations/20261019000002_rls_and_grants.sql`
3. `supabase/migrations/20261019000003_ingest_batch_rpc.sql`

#### Verifying the Schema Safely
Open **SQL Editor → New query**, paste the contents of `supabase/tests/verify_schema.sql`, and click **Run**. It runs inside `BEGIN; ... ROLLBACK;`, verifies all 6 tables, 47 columns on `public.orders`, RLS policies, grants, and the atomic RPC, and rolls back its test rows cleanly.

---

### Step 4: Creating Your First Administrator Account

1. In the Supabase Dashboard, navigate to **Authentication → Users → Add user → Create new user**.
2. Enter your administrator email and password, check **Auto Confirm User**, and click **Create user**.
3. Copy the newly created user's **User UID** and run the following query in the **SQL Editor**:
   ```sql
   INSERT INTO public.admin_users (user_id, email, full_name, is_active)
   VALUES ('<paste-user-uid-here>', 'your-admin@example.com', 'Portal Administrator', true);
   ```
4. *(Optional)* To add additional stores in the future without changing code or tables:
   ```sql
   INSERT INTO public.stores (store_code, store_name, external_store_id, timezone, is_active)
   VALUES ('STORE2', 'Urban Connect Store 2', '5001', 'Asia/Kolkata', true);
   ```

---

### Step 5: Deploying the `ingest-orders` Supabase Edge Function

```bash
# 1. Configure the allowed CORS origins for your GitHub Pages site and local dev server
supabase secrets set ALLOWED_ORIGINS="https://<your-github-username>.github.io,http://localhost:5173"

# 2. Deploy the Edge Function
supabase functions deploy ingest-orders
```

*(Note: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are automatically injected into Supabase Edge Functions by the Supabase runtime.)*

---

### Step 6: GitHub Repository, Secrets & GitHub Pages Configuration

1. Create a new GitHub repository named **`urban-connect-order-ingestion`**.
2. Push this codebase to the `main` branch:
   ```bash
   git init -b main
   git add .
   git commit -m "Initial implementation of Urban Connect Order Ingestion Portal"
   git remote add origin https://github.com/<your-github-username>/urban-connect-order-ingestion.git
   git push -u origin main
   ```
3. In your GitHub repository, go to **Settings → Secrets and variables → Actions → New repository secret** and add:
   - `VITE_SUPABASE_URL`: Your Supabase Project URL
   - `VITE_SUPABASE_ANON_KEY`: Your Supabase public `anon` key
4. Go to **Settings → Pages**:
   - Under **Build and deployment → Source**, select **GitHub Actions**.
5. Every pull request and push to `main` will automatically run `.github/workflows/deploy-pages.yml` (`npm ci` → `npm run lint` → `npm run typecheck` → `npm test` → `npm run build` → credential security check), and pushes to `main` will publish the site to:
   `https://<your-github-username>.github.io/urban-connect-order-ingestion/`

---

## 3. Environment Variables & Secrets Reference

| Variable Name | Scope | Where to Configure | Safe in Frontend Bundle? |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Public Frontend | `.env.local` & GitHub Actions Secrets | **Yes** |
| `VITE_SUPABASE_ANON_KEY` | Public Frontend | `.env.local` & GitHub Actions Secrets | **Yes** (Protected by RLS + Grants) |
| `VITE_APP_TIMEZONE` | Public Frontend | `.env.local` (`Asia/Kolkata`) | **Yes** |
| `ALLOWED_ORIGINS` | Private Backend | `supabase secrets set ALLOWED_ORIGINS=...` | **No** (Edge Function only) |
| `SUPABASE_SERVICE_ROLE_KEY` | Private Backend | Auto-injected in Supabase Edge Runtime | **NEVER** |
| `SUPABASE_DB_PASSWORD` | Private Backend | Supabase CLI / `supabase-production` env | **NEVER** |

---

## 4. Recovery & Rollback Procedures

- **Failed Workbook Upload**: Because `public.ingest_order_batch` runs inside a single PostgreSQL transaction and enforces Strict All-or-Nothing validation, a failed upload never leaves partial order writes. Fix the reported row issues in Excel and re-upload safely.
- **Network Interruption During Upload**: Click **Safe Retry Upload**. File-level (`file_checksum_sha256`) and order-level (`source_row_hash`) idempotency ensure retries never duplicate orders.
- **Database Migration Rollback**: Each migration file under `supabase/migrations/` documents its exact reverse `DROP` statements in its header comment. Never run `supabase db reset` against a production database.
