# `@abstrack/supabase`

Shared Supabase **client factories**, **auth helpers**, and a **`Database`** type for `SupabaseClient<Database>` aligned with the **public** schema (normal PHI columns under RLS per PRD). You **regenerate** `database.types.ts` locally with **`gen types --linked`** after **`db push`** to cloud; CI on `main` **verifies** a match (see [Regenerate / automation](#regenerate--automation) and **[docs/SUPABASE_CLOUD_DEVELOPER.md](../../docs/SUPABASE_CLOUD_DEVELOPER.md)**).

## Environment variables

Use [Supabase hosted API keys](https://supabase.com/docs/guides/api/api-keys) as follows: **publishable** (`sb_publishable_...`) for clients, **secret** (`sb_secret_...`) for trusted server code only.

### What to copy from the dashboard

| Env variable                                                                    | Dashboard source                                                                                   | Value shape                                            |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL` (Next) / `EXPO_PUBLIC_SUPABASE_URL` (Expo)           | **Settings → API** (“Project URL”), **Connect** dialog, or **Integrations → Data API** (“API Url”) | `https://<project-ref>.supabase.co` (no trailing path) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **Settings → API Keys** → publishable key                                                          | `sb_publishable_...`                                   |
| `SUPABASE_SECRET_KEY`                                                           | **Settings → API Keys** → secret key (server-only)                                                 | `sb_secret_...`                                        |

Pass **URL + publishable key** into browser, SSR, and mobile clients. Use **`SUPABASE_SECRET_KEY`** (`sb_secret_...`) only in trusted server code — import **`@abstrack/supabase/admin`**, never the main entry, from route handlers or scripts. **`@abstrack/supabase/admin`** reads **`SUPABASE_SECRET_KEY`** only (not legacy JWT `service_role` env names).

### Where to set them in this repo

| Variable                                                           | File                                                              |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `apps/web/.env.local`, `apps/practitioner/.env.local`             |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `apps/mobile/.env`                                                |
| `SUPABASE_SECRET_KEY`                                              | Same app’s `.env.local` when Next server code runs, or CI secrets |

Full template: [`.env.example`](../../.env.example).

## Package entrypoints

The **default** export (`@abstrack/supabase`) is **Metro-safe**: it does not load `@supabase/ssr`. Use **subpaths** for Next.js so React Native never pulls SSR code.

| Import                           | Use when                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`@abstrack/supabase`**         | Shared types, env readers, **`createSupabaseNativeClient`**, auth helpers, query helpers (Expo / shared code).                                                            |
| **`@abstrack/supabase/browser`** | Next.js **client components** — `getSupabaseBrowserClient()` (`@supabase/ssr`).                                                                                           |
| **`@abstrack/supabase/server`**  | Next.js **server** — `createSupabaseServerClient(cookies)`; pass cookie `getAll` / `setAll` per [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/nextjs). |
| **`@abstrack/supabase/native`**  | Optional alias for **`createSupabaseNativeClient`** only (same as main export; explicit “no SSR” surface).                                                                |
| **`@abstrack/supabase/admin`**   | Secret-key server client only (see below).                                                                                                                                |

### Main (`@abstrack/supabase`)

- **`Database`**, **`Json`**, **`AbstrackSupabaseClient`**
- **`getSupabaseUrl`**, **`getSupabasePublishableKey`**
- **`createSupabaseNativeClient`**, **`NativeAuthStorage`**, **`NativeClientOptions`**
- **Auth:** `signInWithEmailPassword`, `signUpWithEmailPassword`, `signOut`, `getSession`, `getAuthUser`
- **Queries:** `fetchProfileByUserId`, `healthCheckProfilesLimit1`

## Server-only admin API (`@abstrack/supabase/admin`)

- **`getSupabaseSecretKey()`** — reads **`SUPABASE_SECRET_KEY`** (`sb_secret_...`) only (not the legacy JWT `service_role` env name).
- **`getSupabaseAdminClient()`** — client built with that secret key; **bypasses RLS** (elevated access). Use only in audited server jobs or admin routes.

## Regenerate / automation

**Recommended (one PR with migration + types):** from the repo root, linked to the same Supabase Cloud project—**`db push` first**, then typegen (**`--linked` reads cloud**):

```bash
pnpm dlx supabase db push
pnpm dlx supabase gen types typescript --linked --schema public > packages/supabase/src/lib/database.types.ts
pnpm exec prettier --write packages/supabase/src/lib/database.types.ts
```

Commit migration file(s) and `database.types.ts`. **GitHub Actions** still runs **`db push`** on **`main`** after merge as a backstop. Full narrative: **[docs/SUPABASE_CLOUD_DEVELOPER.md](../../docs/SUPABASE_CLOUD_DEVELOPER.md)**.

**On `main` after CI `db push`:** [`.github/workflows/supabase-migrations.yml`](../../.github/workflows/supabase-migrations.yml) **diffs** committed `database.types.ts` against `gen types --linked` output—**does not commit**; fix locally and push if it fails.

**On pull requests that change `supabase/migrations/`:** [`.github/workflows/supabase-db-types-pr.yml`](../../.github/workflows/supabase-db-types-pr.yml) starts Supabase **inside GitHub’s CI runner** (Docker on the runner) and compares types there. That is **not** something you run on your laptop; it is an extra guard in CI.

**Optional — compare before push (linked cloud):** same idea as CI on `main` — extract the body from `export type Json`, run `gen types --linked` to a temp file, format both with **`pnpm exec prettier --config prettier.database-types.json --write <files>`**, then `diff`. Usually **`gen types` → Prettier** on `database.types.ts` in place (root config applies the override) is enough.

## Building and tests

```bash
nx build supabase
nx test supabase
```

Vitest runs from the workspace root; this package does not list `vitest` in its own `package.json`. `@nx/dependency-checks` ignores `vitest` in `eslint.config.mjs` (same pattern as other libraries here).
