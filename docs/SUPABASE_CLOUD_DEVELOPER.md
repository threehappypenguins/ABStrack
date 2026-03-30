# Supabase Cloud — what you do, when (and notes for AI)

This project uses **Supabase Cloud** as the development database.

**Recommended setup (this repo):**

1. **GitHub Actions** still runs **`supabase db push`** when changes land on **`main`**—so merged code and cloud stay aligned even if you forget a manual step.
2. **You manually** run **`db push`** from your laptop **when needed** (usually **before merge**, on your feature branch) so cloud has the new migration **before** you run **`gen types typescript --linked`**. That lets you put **migration SQL + `database.types.ts` in one PR** without waiting for merge.

**There is no requirement to run a local Supabase Docker stack** for this path—only the Supabase **CLI** (login + link + `db push` + `gen types`).

---

## Ground rules (read first)

| Fact | Implication |
|------|-------------|
| **Canonical DB is Supabase Cloud** | `db push` applies `supabase/migrations/` to your hosted project (CLI on your laptop **and/or** GitHub Actions on `main`). |
| **`supabase db reset` is local-only** | It only affects a **Docker** database from `supabase db start` (your machine or CI). It does **not** reset cloud. |
| **`gen types typescript --linked` reads cloud** | It does not “read” new SQL from git until that SQL has been applied to cloud via **`db push`**. |

---

## Recommended workflow: one PR (manual `db push` + `gen types`, CI as backstop)

Use this when you add or change **`supabase/migrations/*.sql`** and want **`database.types.ts` in the same PR**:

1. **Supabase CLI once per machine:** `pnpm dlx supabase login` and `pnpm dlx supabase link --project-ref <project-ref>` (see [DEV_SETUP.md §4](DEV_SETUP.md#4-supabase-database-migrations-cloud-cli-and-ci)).
2. **Commit** your new/edited migration file(s) on your branch.
3. **Apply migrations to cloud from your laptop** (same linked project as production/dev cloud):

   ```bash
   pnpm dlx supabase db push
   ```

   Optional: `pnpm dlx supabase db push --dry-run` first.

4. **Regenerate types** (cloud now matches your migration):

   ```bash
   pnpm dlx supabase gen types typescript --linked --schema public > packages/supabase/src/lib/database.types.ts
   pnpm exec prettier --write packages/supabase/src/lib/database.types.ts
   ```

   The redirect overwrites the whole file. If you keep the docblock above `export type Json`, paste it back from the previous commit or merge only the generated body. CI compares from `export type Json` downward, so the header does not need to match the CLI output.

   **Prettier for this file:** `.prettierrc.cjs` overrides **`packages/supabase/src/lib/database.types.ts`** only, using options from **`prettier.database-types.json`** (`semi: false`, `singleQuote: false`) so formatting matches `supabase gen types`. GitHub Actions uses that same JSON with `--config` when formatting temp files for the diff.

5. **Commit** `packages/supabase/src/lib/database.types.ts` and **open / update your PR** with both files.
6. **Merge to `main`.** GitHub Actions runs **`db push` again**; for migrations you already applied, that is typically a **no-op**. The workflow then **verifies** that committed `database.types.ts` matches **`gen types --linked`** output—if something drifted, fix and push.

**Why manual `db push` before merge?** So cloud is updated **before** `--linked` typegen. If you only relied on CI `db push` after merge, `--linked` could not reflect the new schema until after merge—splitting migration and types across PRs.

**You still keep GitHub Actions** so **`main`** stays the source of truth: merges you make without a local `db push` (e.g. hotfix) still apply pending migrations from git to cloud.

---

## If you skip local `db push` before merge

Then the migration hits cloud when **CI runs `db push` on `main`** after merge. **`gen types --linked`** only works **after** that. You would need to **regenerate types and commit** in a **follow-up** commit (or PR) unless the [PR types workflow](../.github/workflows/supabase-db-types-pr.yml) already forced an updated file via its Docker-based check.

---

## One-time setup checklist

1. **GitHub Actions:** repository secrets for [`.github/workflows/supabase-migrations.yml`](../.github/workflows/supabase-migrations.yml)—see [DEV_SETUP.md §4](DEV_SETUP.md#4-supabase-database-migrations-cloud-cli-and-ci) (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD`).
2. **Your laptop (for the recommended migration flow):** `pnpm dlx supabase login`, `pnpm dlx supabase link --project-ref <project-ref>`.

---

## Day-to-day: no database work

- Ordinary app code: no Supabase CLI.
- Env files point at cloud (DEV_SETUP §3).

---

## Types file: no bot

| What | Who / what |
|------|------------|
| **`database.types.ts` in git** | **You** regenerate with **`gen types --linked`** + Prettier and **commit**. Nothing auto-commits. |
| **Verify on `main`** | After CI `db push`, the workflow **diffs** committed types vs `--linked` output; **fails** if they differ (run the regen commands and push). |

---

## After you change migrations or `database.types.ts`: check the TypeScript package

**`db push` and `gen types` only refresh the schema snapshot.** They do **not** compile or test **`@abstrack/supabase`** (clients, auth, queries). After any migration/typegen work—or before you push a PR that touches `packages/supabase`—run:

```bash
pnpm exec nx run supabase:lint
pnpm exec nx run supabase:test
pnpm exec nx run supabase:build
```

For the whole workspace (closer to CI), see [DEV_SETUP.md §5](DEV_SETUP.md#5-verify-the-workspace).

---

## PR check (Supabase in Docker on GitHub runners only)

[`.github/workflows/supabase-db-types-pr.yml`](../.github/workflows/supabase-db-types-pr.yml) runs `supabase db start` / `db reset` **on the CI machine** (Docker on the runner) and compares types to your committed file. That is **not** “local Supabase on your laptop”; it is an automated check in GitHub. It does **not** replace the recommended **`db push` + `gen types --linked`** flow on your side when you change migrations.

---

## Cloud-only development (no Docker on your machine)

**You do not need Docker** for the recommended path—only **`db push`** and **`gen types --linked`** against Supabase Cloud. **Docker** in this repo only appears **inside** certain GitHub Actions jobs, not as a requirement for your computer.

---

## Instructions for AI assistants (Cursor, Copilot, etc.)

1. **Assume Supabase Cloud** for development—not `supabase start` on Sarah’s laptop unless she says so.

2. **Recommended migration flow for Sarah:** when changing **`supabase/migrations/`**, tell her—in the **same message**—to run **`db push`** to cloud **then** **`gen types --linked`** + Prettier **then** commit **both** migration and `packages/supabase/src/lib/database.types.ts` **before** or as part of merge (see **Recommended workflow** above). **GitHub Actions** still runs `db push` on `main` as a backstop.

3. **Never imply `supabase db reset` affects cloud.** Local Docker only (or CI-only).

4. **Say explicitly** when she must use **her terminal** (CLI login, link, `db push`, `gen types`) vs what CI does after merge.

5. **Do not** imply a bot commits `database.types.ts`.

6. **Ask before changing** `.github/workflows/*` deployment or secrets without her approval.

7. When **`database.types.ts`** or **`supabase/migrations/`** are involved, point to **`gen types --linked`** + Prettier (see **Recommended workflow** above) and that **[`.github/workflows/supabase-migrations.yml`](../.github/workflows/supabase-migrations.yml)** verifies on `main` after `db push`. **Do not** suggest Docker on her laptop unless she asks.

---

## Related files

| Topic | Location |
|-------|----------|
| CLI install, link, secrets | [DEV_SETUP.md §4](DEV_SETUP.md#4-supabase-database-migrations-cloud-cli-and-ci) |
| Migrations + verify on `main` | [`.github/workflows/supabase-migrations.yml`](../.github/workflows/supabase-migrations.yml) |
| PR types check | [`.github/workflows/supabase-db-types-pr.yml`](../.github/workflows/supabase-db-types-pr.yml) |
| App env vars | [`packages/supabase/README.md`](../packages/supabase/README.md), [`.env.example`](../.env.example) |
