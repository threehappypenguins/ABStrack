# supabase

**Status:** Scaffold only. The exported API is still the Nx-generated placeholder (`supabase()` in `src/lib/supabase.ts`). Planned work — Supabase client factory, auth helpers, and typed query wrappers — is tracked under **Week 2** in [docs/ROADMAP.md](../../docs/ROADMAP.md).

The sections below document **environment variables** the apps will use once that implementation exists; they are accurate for setup today.

## Environment variables

Use [Supabase hosted API keys](https://supabase.com/docs/guides/api/api-keys) as follows. Prefer **publishable** (`sb_publishable_...`) and **secret** (`sb_secret_...`) over legacy JWT **anon** / **service_role** keys (legacy keys still work during migration; CLI and self-hosted setups often need them).

### What to copy from the dashboard

| Env variable | Dashboard source | Value shape |
|--------------|------------------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` (Next) / `EXPO_PUBLIC_SUPABASE_URL` (Expo) | **Project Settings → API** (“Project URL”), **Connect** dialog, or **Integrations → Data API** (“API Url”) | `https://<project-ref>.supabase.co` (no trailing path) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **Project Settings → API Keys** → publishable key | `sb_publishable_...` |
| `SUPABASE_SECRET_KEY` | **Project Settings → API Keys** → secret key (server-only) | `sb_secret_...` |

Pass **URL + publishable key** (or legacy anon) into `createClient(url, key)` for browser and mobile clients. Use **secret key** (or legacy `service_role`) only in trusted server code, CI, or scripts — never in `NEXT_PUBLIC_*`, `EXPO_PUBLIC_*`, or app bundles.

### Where to set them in this repo

| Variable | File |
|----------|------|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `apps/web/.env.local`, `apps/practitioner/.env.local` |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `apps/mobile/.env` |
| `SUPABASE_SECRET_KEY` | Same app’s `.env.local` when that Next server code runs, or CI secrets |

### Legacy (optional)

If you have not migrated: `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` (JWT “anon” from **API Keys → Legacy**) and `SUPABASE_SERVICE_ROLE_KEY` (JWT “service_role”) — same `createClient` second-argument slot as the publishable key; do not expose `service_role`.

Full template and notes: [`.env.example`](../../.env.example).

## Building

Run `nx build supabase` to build the library.

## Running unit tests

Run `nx test supabase` to execute the unit tests via [Vitest](https://vitest.dev/) from the **workspace root**. This package does **not** list `vitest` in its own `package.json` — it is not a runtime dependency of the library, and duplicating it here would widen the dependency graph for no benefit. The same pattern applies to the other Nx Vitest libraries in `packages/*` (`ui`, `crypto`, `types`, `powersync`).
