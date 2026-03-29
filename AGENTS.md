# Repository instructions for AI coding agents

## Supabase: cloud + CLI on Sarah’s machine for migrations

**Sarah uses Supabase Cloud.** **GitHub Actions** runs **`supabase db push`** when code merges to **`main`** (backstop: `main` and cloud stay aligned).

**For migration work, the recommended flow** is that **Sarah also runs `db push` from her laptop** (linked CLI) **before merge**, then **`gen types typescript --linked`** + Prettier, then commits **migration SQL + `database.types.ts` in one PR**. That way `--linked` sees the new schema because cloud already has the migration.

Details: **[docs/SUPABASE_CLOUD_DEVELOPER.md](docs/SUPABASE_CLOUD_DEVELOPER.md)**.

- **`supabase db reset`** is **local Docker only** (or CI-only), not cloud.
- **`database.types.ts` is not auto-committed** by any bot.

## When you MUST tell Sarah to run commands (migrations / types)

If you add, edit, or rename **`supabase/migrations/*.sql`**, or change anything that affects **`database.types.ts`**, tell her **in the same response** to follow the **recommended workflow** in **SUPABASE_CLOUD_DEVELOPER.md**—at minimum these commands **from the repo root** (after `login` + `link`):

```bash
pnpm dlx supabase db push
pnpm dlx supabase gen types typescript --linked --schema public > packages/supabase/src/lib/database.types.ts
pnpm exec prettier --write packages/supabase/src/lib/database.types.ts
```

Then **commit** both the migration file(s) and **`packages/supabase/src/lib/database.types.ts`**.

**Order matters:** `db push` **before** `gen types --linked` (linked reads **cloud**).

## Tell Sarah when she must run something (general)

If a step needs **her** terminal, **dashboard**, or **GitHub** settings, say so explicitly—do not imply it already ran.

## Before changing automation

Do **not** change `.github/workflows/*` deployment, permissions, or secrets without **asking Sarah first**.
