# `@abstrack/supabase`

Shared Supabase **client factories**, **auth helpers**, and a **`Database`** type for `SupabaseClient<Database>` aligned with the **public** schema (normal PHI columns under RLS per PRD). You **regenerate** `database.types.ts` locally with **`gen types --linked`** after **`db push`** to cloud; CI on `main` **verifies** a match (see [Regenerate / automation](#regenerate--automation) and **[docs/SUPABASE_CLOUD_DEVELOPER.md](../../docs/SUPABASE_CLOUD_DEVELOPER.md)**).

## Environment variables

Use [Supabase hosted API keys](https://supabase.com/docs/guides/api/api-keys) as follows. Prefer **publishable** (`sb_publishable_...`) and **secret** (`sb_secret_...`) over legacy JWT **anon** / **service_role** keys.

### What to copy from the dashboard

| Env variable | Dashboard source | Value shape |
|--------------|------------------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` (Next) / `EXPO_PUBLIC_SUPABASE_URL` (Expo) | **Project Settings → API** (“Project URL”), **Connect** dialog, or **Integrations → Data API** (“API Url”) | `https://<project-ref>.supabase.co` (no trailing path) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **Project Settings → API Keys** → publishable key | `sb_publishable_...` |
| `SUPABASE_SECRET_KEY` | **Project Settings → API Keys** → secret key (server-only) | `sb_secret_...` |

Pass **URL + publishable key** (or legacy anon) into browser, SSR, and mobile clients. Use **`SUPABASE_SECRET_KEY`** (`sb_secret_...`) only in trusted server code — import **`@abstrack/supabase/admin`**, never the main entry, from route handlers or scripts. **`@abstrack/supabase/admin` does not read legacy JWT `service_role` keys.**

### Where to set them in this repo

| Variable | File |
|----------|------|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `apps/web/.env.local`, `apps/practitioner/.env.local` |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `apps/mobile/.env` |
| `SUPABASE_SECRET_KEY` | Same app’s `.env.local` when Next server code runs, or CI secrets |

### Legacy (optional, clients only)

`NEXT_PUBLIC_SUPABASE_ANON_KEY` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` — fallback for `createClient` when publishable keys are not enabled yet. Do not use JWT **service_role** in client bundles; server admin uses **`SUPABASE_SECRET_KEY`** only.

Full template: [`.env.example`](../../.env.example).

## Public API (`@abstrack/supabase`)

- **`Database`**, **`Json`** — types for `SupabaseClient<Database>`.
- **`getSupabaseUrl`**, **`getSupabasePublishableKey`** — read documented env names (client-safe).
- **`getSupabaseBrowserClient()`** — Next.js client components via `@supabase/ssr` `createBrowserClient`.
- **`createSupabaseServerClient(cookies)`** — server components, route handlers, middleware; pass `getAll` / `setAll` from `next/headers` or `NextRequest`/`NextResponse` per [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/nextjs).
- **`createSupabaseNativeClient(storage)`** — React Native / Expo; pass `AsyncStorage` (or similar) for session persistence.
- **Auth:** `signInWithEmailPassword`, `signUpWithEmailPassword`, `signOut`, `getSession`, `getAuthUser` (prefer `getAuthUser` on the server).
- **Queries:** `fetchProfileByUserId`, `healthCheckProfilesLimit1` (lightweight RLS/session check).

## Server-only admin API (`@abstrack/supabase/admin`)

- **`getSupabaseServiceRoleKey()`** — reads **`SUPABASE_SECRET_KEY`** (`sb_secret_...`) only.
- **`getSupabaseAdminClient()`** — service-role client (bypasses RLS). Use only in audited server jobs or admin routes.

## Regenerate / automation

**Recommended (one PR with migration + types):** from the repo root, linked to the same Supabase Cloud project—**`db push` first**, then typegen (**`--linked` reads cloud**):

```bash
pnpm dlx supabase db push
pnpm dlx supabase gen types typescript --linked --schema public > packages/supabase/src/lib/database.types.ts
pnpm exec prettier --write packages/supabase/src/lib/database.types.ts
```

Commit migration file(s) and `database.types.ts`. **GitHub Actions** still runs **`db push`** on **`main`** after merge as a backstop. Full narrative: **[docs/SUPABASE_CLOUD_DEVELOPER.md](../../docs/SUPABASE_CLOUD_DEVELOPER.md)**.

**On `main` after CI `db push`:** [`.github/workflows/supabase-migrations.yml`](../../.github/workflows/supabase-migrations.yml) **diffs** committed `database.types.ts` against `gen types --linked` output—**does not commit**; fix locally and push if it fails.

**On pull requests that change `supabase/migrations/`:** [`.github/workflows/supabase-db-types-pr.yml`](../../.github/workflows/supabase-db-types-pr.yml) may use a **CI-only** Docker stack as an extra check.

**Optional (local Docker, not cloud):**

```bash
supabase db start && supabase db reset --yes
supabase gen types typescript --local --schema public > packages/supabase/src/lib/database.types.ts
pnpm exec prettier --write packages/supabase/src/lib/database.types.ts
```

## Building and tests

```bash
nx build supabase
nx test supabase
```

Vitest runs from the workspace root; this package does not list `vitest` in its own `package.json`. `@nx/dependency-checks` ignores `vitest` in `eslint.config.mjs` (same pattern as other libraries here).
