# Supabase Cloud — what you do, when (and notes for AI)

This project uses **Supabase Cloud** as the development database.

### For AI coding agents

Follow **[AGENTS.md](../AGENTS.md)** (section **Correct flow for migrations and database.types.ts**). In short: edit migration SQL during review; **do not** hand-edit **`packages/supabase/src/lib/database.types.ts`**; after review, Sarah runs **`db push`** then **`gen types typescript --linked`**, then commits the generated file with the migration. **`gen types` does not read `.sql` files**—only the live DB (`--linked` = cloud).

**Recommended setup (this repo):**

1. **GitHub Actions** still runs **`supabase db push`** when changes land on **`main`**—so merged code and cloud stay aligned even if you forget a manual step.
2. **GitHub Actions** runs **`powersync validate`** on every PR and branch push when that YAML changes, and **`deploy sync-config`** only when **`main`** is updated—see **[PowerSync Sync Streams](#powersync-sync-streams-packagespowersyncsync-rulesyaml)** (secrets required).
3. **You manually** run **`db push`** from your laptop **when needed** (usually **before merge**, on your feature branch) so cloud has the new migration **before** you run **`gen types typescript --linked`**. That lets you put **migration SQL + `database.types.ts` in one PR** without waiting for merge.

**Wait to `db push` until the migration is stable (e.g. after Copilot / PR review).** Review tools often suggest edits to the same `supabase/migrations/*.sql` file. If you **`db push` too early**, cloud records that migration version as **already applied**; changing the file in git does **not** automatically re-apply it. Safer habit: keep migration work in the PR, finish review-driven SQL tweaks, **then** run **`db push`** once, **`gen types --linked`**, commit `database.types.ts`, and merge. See **[Revising a migration already pushed to cloud (development)](#revising-a-migration-already-pushed-to-cloud-development)** if you jumped the gun.

**There is no requirement to run a local Supabase Docker stack** for this path—only the Supabase **CLI** (login + link + `db push` + `gen types`).

---

## Ground rules (read first)

| Fact                                            | Implication                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Canonical DB is Supabase Cloud**              | `db push` applies `supabase/migrations/` to your hosted project (CLI on your laptop **and/or** GitHub Actions on `main`). |
| **`supabase db reset` is local-only**           | It only affects a **Docker** database from `supabase db start` (your machine or CI). It does **not** reset cloud.         |
| **`gen types typescript --linked` reads cloud** | It does not “read” new SQL from git until that SQL has been applied to cloud via **`db push`**.                           |

---

## Recommended workflow: one PR (manual `db push` + `gen types`, CI as backstop)

Use this when you add or change **`supabase/migrations/*.sql`** and want **`database.types.ts` in the same PR**:

1. **Supabase CLI once per machine:** `pnpm dlx supabase login` and `pnpm dlx supabase link --project-ref <project-ref>` (see [DEV_SETUP.md §4](DEV_SETUP.md#4-supabase-database-migrations-cloud-cli-and-ci)).
2. **Commit** your new/edited migration file(s) on your branch.
3. **When the SQL is ready to land** (after any Copilot or human review you care about), **apply migrations to cloud** from your laptop (same linked project as production/dev cloud):

   ```bash
   pnpm dlx supabase db push
   ```

   Optional: `pnpm dlx supabase db push --dry-run` first.

   **Avoid pushing too early** if you expect more edits to the same migration file—see the note at the top of this doc and **[Revising a migration already pushed to cloud (development)](#revising-a-migration-already-pushed-to-cloud-development)** below.

4. **Regenerate types** (cloud now matches your migration):

   ```bash
   pnpm dlx supabase gen types typescript --linked --schema public > packages/supabase/src/lib/database.types.ts
   pnpm exec prettier --write packages/supabase/src/lib/database.types.ts
   ```

   **Important:** keep the redirect target exactly as shown above. Do **not** write to repo root (for example, `> database.types.ts`), because CI checks `packages/supabase/src/lib/database.types.ts`.

   The redirect overwrites the whole file. If you keep the docblock above `export type Json`, paste it back from the previous commit or merge only the generated body. CI compares from `export type Json` downward, so the header does not need to match the CLI output.

   **Prettier for this file:** `.prettierrc.cjs` overrides **`packages/supabase/src/lib/database.types.ts`** only, using options from **`prettier.database-types.json`** (`semi: false`, `singleQuote: false`) so formatting matches `supabase gen types`. GitHub Actions uses that same JSON with `--config` when formatting temp files for the diff.

   **Do not “fix” the generated file by hand** (for example removing `Insert`/`Update` fields for `GENERATED` columns or adding comments inside the `Database` type). The types check compares your committed file to **`supabase gen types typescript --local`**; manual edits that do not match the CLI will fail CI. Use wrapper types in application code when you need stricter insert/update shapes (see `packages/supabase/src/lib/health-markers-db-write-types.ts` for `health_markers`).

5. **Commit** `packages/supabase/src/lib/database.types.ts` and **open / update your PR** with both files.
6. **Merge to `main`.** GitHub Actions runs **`db push` again**; for migrations you already applied, that is typically a **no-op**. The workflow then **verifies** that committed `database.types.ts` matches **`gen types --linked`** output—if something drifted, fix and push.

**Why manual `db push` before merge?** So cloud is updated **before** `--linked` typegen. If you only relied on CI `db push` after merge, `--linked` could not reflect the new schema until after merge—splitting migration and types across PRs.

**You still keep GitHub Actions** so **`main`** stays the source of truth: merges you make without a local `db push` (e.g. hotfix) still apply pending migrations from git to cloud.

---

## Revising a migration already pushed to cloud (development)

Supabase records **which migration versions** have been applied. **Deleting rows in your app tables does not “undo” a migration** or let you re-run the same file from git.

- **What changed?** Know whether the migration created **tables/data** or only **functions / policies / triggers**. Many migrations only add or replace objects; there may be nothing useful to delete in user data.
- **Same file, new SQL, already `db push`’d:** `db push` will **not** re-apply that version. Practical options on a **throwaway dev** project with **no production data** you care about:
  1. **Preferred for teams / shared history:** add a **new** migration that applies the fix (e.g. `CREATE OR REPLACE FUNCTION ...`).
  2. **Solo dev, empty DB:** use the CLI to mark the version **reverted** on the remote, then **`db push`** again so the updated file applies. Example (use your migration’s timestamp from the filename):

     ```bash
     pnpm dlx supabase migration repair 20260410120000 --status reverted
     pnpm dlx supabase db push
     ```

     Use the timestamp from your migration filename (without the rest of the name). Confirm flags with `pnpm dlx supabase migration repair --help`. **Do not use this on production** unless you fully understand the impact on migration history.

  3. **Quick one-off:** run the corrected SQL (e.g. `CREATE OR REPLACE FUNCTION ...`) in the **Supabase SQL editor** on that project. Your git migration file and cloud can still match **if** the final SQL in git is what you ran; avoid leaving cloud and repo diverged.

- **Local Docker only:** `supabase db reset` reapplies **all** migrations from scratch; it does **not** affect cloud.

---

## If you skip local `db push` before merge

Then the migration hits cloud when **CI runs `db push` on `main`** after merge. **`gen types --linked`** only works **after** that. You would need to **regenerate types and commit** in a **follow-up** commit (or PR) unless the [PR types workflow](../.github/workflows/supabase-db-types-pr.yml) already forced an updated file via its Docker-based check.

---

## One-time setup checklist

1. **GitHub Actions:** repository secrets for [`.github/workflows/supabase-migrations.yml`](../.github/workflows/supabase-migrations.yml)—see [DEV_SETUP.md §4](DEV_SETUP.md#4-supabase-database-migrations-cloud-cli-and-ci) (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD`).
2. **GitHub Actions (PowerSync):** optional but recommended if you use PowerSync Cloud—secrets for [`.github/workflows/powersync-sync-config.yml`](../.github/workflows/powersync-sync-config.yml)—see [DEV_SETUP.md → PowerSync sync config](DEV_SETUP.md#powersync-sync-config-github-actions).
3. **Your laptop (for the recommended migration flow):** `pnpm dlx supabase login`, `pnpm dlx supabase link --project-ref <project-ref>`.

---

## Day-to-day: no database work

- Ordinary app code: no Supabase CLI.
- Env files point at cloud (DEV_SETUP §3).

---

## Types file: no bot

| What                           | Who / what                                                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **`database.types.ts` in git** | **You** regenerate with **`gen types --linked`** + Prettier and **commit**. Nothing auto-commits.                                            |
| **Verify on `main`**           | After CI `db push`, the workflow **diffs** committed types vs `--linked` output; **fails** if they differ (run the regen commands and push). |

---

## After you change migrations or `database.types.ts`: check the TypeScript package

**`db push` and `gen types` only refresh the schema snapshot.** They do **not** compile or test **`@abstrack/supabase`** (clients, auth, queries). After any migration/typegen work—or before you push a PR that touches `packages/supabase`—run:

```bash
pnpm exec nx run supabase:lint
pnpm exec nx run supabase:test
pnpm exec nx run supabase:build
```

For the whole workspace (closer to CI), see [DEV_SETUP.md §5](DEV_SETUP.md#5-verify-the-workspace).

### Preset RLS integration tests

[`packages/supabase/src/preset-flows.integration.spec.ts`](../packages/supabase/src/preset-flows.integration.spec.ts) exercises **symptom** and **health marker** preset CRUD, reorder RPCs, and cross-user denial against your **Supabase Cloud** project (same env model as the apps: publishable URL + key for user clients, secret key only for provisioning disposable test users). It **skips** when `SUPABASE_SECRET_KEY` is unset or public URL/key are missing, so default CI and local runs without secrets stay green.

**Local (linked cloud):** Vitest runs in Node and **does not** load `apps/web/.env.local`, `apps/practitioner/.env.local`, `apps/mobile/.env`, or a `packages/supabase/.env` file. Those files are for each app’s bundler; the test process only sees variables already in the environment (or what CI injects).

Put the same values you use in development into your shell, then run the tests—for example from the repo root. The secret key value comes from the Supabase UI under **Settings → API Keys** (secret key row; server-only).

```bash
export SUPABASE_SECRET_KEY='sb_secret_...'
export NEXT_PUBLIC_SUPABASE_URL='https://YOUR_PROJECT_REF.supabase.co'
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='sb_publishable_...'
pnpm exec nx test @abstrack/supabase
```

(You can paste the three lines into a **gitignored** file such as a personal `~/abstrack-test.env` and run `set -a && source ~/abstrack-test.env && set +a` before the command if you prefer not to type them each time.)

`.env.example` documents `SUPABASE_SECRET_KEY` for server-only use; there is **no** requirement to create a dedicated `.env` inside `packages/supabase/`.

**How to tell it ran:** In the Vitest output, `preset-flows.integration.spec.ts` should show **passed** tests (not “skipped”). If the suite is **skipped**, the integration env was incomplete—`ABSTRACK_PRESET_INTEGRATION_LOG=1` on the same command prints a short reason. The suite **creates two Auth users and deletes them in `afterAll`**, so they usually disappear in seconds; refreshing **Authentication → Users** during the run will often show **nothing** because deletion already ran. **Do not** rely on the dashboard alone—use the terminal output and the `console.info` lines that list the disposable user emails.

**Nx cache:** `nx test` results are cached. If you once ran without `SUPABASE_SECRET_KEY` (integration skipped), a later run **with** the secret could still replay that cached “skipped” result until the cache key changes. The workspace `nx.json` includes Supabase-related env vars in the **test** task hash so skip vs run is distinguished. If you still see a stale result, run **`pnpm exec nx reset`** or **`NX_SKIP_NX_CACHE=true pnpm exec nx test @abstrack/supabase`** once.

**CI:** add repository secret **`SUPABASE_SECRET_KEY`** with the same secret key string shown in the Supabase UI under **Settings → API Keys** (**secret** / legacy **service_role** — server-only, never client bundles). [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) passes it **only** to the **Test @abstrack/supabase** step (`env: SUPABASE_SECRET_KEY: ${{ secrets.SUPABASE_SECRET_KEY }}`), not to the whole job, so other steps and actions do not see it. Integration tests run when the secret is present. Fork PRs do not receive secrets, so those jobs skip integration and still pass.

**Security note:** the suite confirms **plaintext PHI under RLS** (values readable with the secret client match what the patient wrote); it does **not** add encryption. It does **not** cover caretaker or practitioner grant paths (those need grant rows and role fixtures).

---

## PR check (Supabase in Docker on GitHub runners only)

[`.github/workflows/supabase-db-types-pr.yml`](../.github/workflows/supabase-db-types-pr.yml) runs `supabase db start` / `db reset` **on the CI machine** (Docker on the runner) and compares types to your committed file. That is **not** “local Supabase on your laptop”; it is an automated check in GitHub. It does **not** replace the recommended **`db push` + `gen types --linked`** flow on your side when you change migrations.

---

## PowerSync Sync Streams (`packages/powersync/sync-rules.yaml`)

**Copy-paste CLI (repo root):** see **[`packages/powersync/README.md` → Validate or deploy sync rules (CLI)](../packages/powersync/README.md#validate-or-deploy-sync-rules-cli)** for **`pull instance` → copy `sync-rules.yaml` → `validate` / `deploy sync-config`** (same as CI). A bare **`powersync validate`** without **`--directory`** (and no linked config folder) typically errors; pass **`--directory`** to the folder that contains **`service.yaml`** and **`sync-config.yaml`**.

PowerSync Cloud stores **Sync Streams** (edition 3 YAML) separately from Postgres migrations. The repo copy lives at **`packages/powersync/sync-rules.yaml`**.

**Idempotency:** Running **`powersync deploy sync-config`** again with the same file (or re-running the GitHub Action) is normal. PowerSync applies the config again; it does **not** behave like SQL migrations where duplicate versions conflict. You still want PR review because a bad YAML change affects live sync scope immediately after deploy.

### Manual CLI (when you deploy or validate yourself)

Install/run the CLI via npm ([PowerSync CLI](https://docs.powersync.com/tools/cli)); this repo pins the same major/minor as CI (`powersync@0.9.4` — bump **`POWERSYNC_CLI_VERSION`** in [`.github/workflows/powersync-sync-config.yml`](../.github/workflows/powersync-sync-config.yml) when you intentionally upgrade).

**If `powersync: command not found`:** the binary is not on your `PATH` unless you install it globally. Run it ad hoc with **`pnpm dlx powersync@0.9.4 …`** or **`npx --yes powersync@0.9.4 …`** (pin the version to match CI; **`--yes`** skips npx’s install prompt). The steps below use **`pnpm dlx`**; substitute **`npx --yes`** if you prefer npm’s runner. Or **`npm install -g powersync@0.9.4`** so bare **`powersync`** works.

1. **Personal access token:** create one in the [PowerSync Dashboard → Access tokens](https://dashboard.powersync.com/account/access-tokens). It is **one** token. **GitHub Actions** stores it as the repository secret **`POWERSYNC_ADMIN_TOKEN`**; the workflow maps that value into **`PS_ADMIN_TOKEN`** for the CLI ([`powersync-sync-config.yml`](../.github/workflows/powersync-sync-config.yml)). On **your laptop**, either run **`login`** (no export needed after it succeeds) or **`export PS_ADMIN_TOKEN='…'`** before **`validate`** / **`deploy`**—that is the same PAT, only the env var name matches what the CLI expects locally.

2. **Instance + project IDs:** from your PowerSync project/instance (Dashboard). Export **`INSTANCE_ID`**, **`PROJECT_ID`**, and **`ORG_ID`** only if your token has multiple organizations ([CLI / CI env vars](https://docs.powersync.com/tools/cli#deploying-from-ci-eg-github-actions)).

3. **Validate** (full **`powersync validate`**: schema, connections, Cloud sync config — same as CI):

   ```bash
   export PS_ADMIN_TOKEN='your-pat'
   export INSTANCE_ID='your-instance-id'
   export PROJECT_ID='your-project-id'
   # Optional if your PAT spans multiple orgs:
   # export ORG_ID='your-org-id'

   REPO_ROOT=$(git rev-parse --show-toplevel)
   CONFIG_DIR=$(mktemp -d)
   cd "$CONFIG_DIR"
   pull_args=(pull instance --directory=. --instance-id="$INSTANCE_ID" --project-id="$PROJECT_ID")
   [ -n "${ORG_ID:-}" ] && pull_args+=(--org-id="$ORG_ID")
   pnpm dlx powersync@0.9.4 "${pull_args[@]}"
   cp "$REPO_ROOT/packages/powersync/sync-rules.yaml" ./sync-config.yaml

   validate_args=(validate --directory=. --instance-id="$INSTANCE_ID" --project-id="$PROJECT_ID")
   [ -n "${ORG_ID:-}" ] && validate_args+=(--org-id="$ORG_ID")
   pnpm dlx powersync@0.9.4 "${validate_args[@]}"
   ```

   Use **`cd …` + `--directory=.`**: the CLI resolves **`--directory`** relative to **`cwd`**; an absolute path can leave files in an unexpected place while logs show the path you passed.

   **`Directory "powersync" not found`:** you ran **`validate`** without a linked config folder. Use the block above. **`npx`** may print **`npm notice`** lines about upgrading npm—that is npm’s own output.

4. **Deploy sync config only** (stay in **`$CONFIG_DIR`**; does not redeploy full service config):

   ```bash
   deploy_args=(deploy sync-config --directory=. --instance-id="$INSTANCE_ID" --project-id="$PROJECT_ID")
   [ -n "${ORG_ID:-}" ] && deploy_args+=(--org-id="$ORG_ID")
   pnpm dlx powersync@0.9.4 "${deploy_args[@]}"
   ```

**Interactive login:** **`pnpm dlx powersync@0.9.4 login`** or **`npx --yes powersync@0.9.4 login`** opens the browser so PowerSync can give this machine a token. After that, **`validate`** / **`deploy`** can use that saved token instead of **`PS_ADMIN_TOKEN`**.

On **Linux**, the CLI often cannot use a system keychain, so it may ask: _store the token in plaintext under **`~/.config/powersync/config.yaml`**, or use \*\*`PS_ADMIN_TOKEN` instead?_

- **`y`:** saves the token in that file on your machine (only your user account should read it). Convenient for repeat runs.
- **`N`:** does not write the token to disk; use **`export PS_ADMIN_TOKEN='…'`** in the same terminal before **`validate`** / **`deploy`** (same as the scripted steps above). Fine if you prefer not to keep a PAT in a file.

### GitHub Actions (backstop on merge)

[`.github/workflows/powersync-sync-config.yml`](../.github/workflows/powersync-sync-config.yml) runs when **`packages/powersync/sync-rules.yaml`** (or that workflow file) changes:

- **`pull_request`:** **`powersync validate`** (full checks: schema, connections, Cloud sync config) on same-repo branches when **`POWERSYNC_ADMIN_TOKEN`**, **`POWERSYNC_INSTANCE_ID`**, and **`POWERSYNC_PROJECT_ID`** are set; fork PRs skip the job — GitHub does not expose secrets to forks.
- **`push` to any branch:** same **`validate`** job when those secrets exist; on **`main`**, **`deploy sync-config`** runs only after a successful validate that actually ran the CLI (**`powersync_ready`**).
- **`workflow_dispatch`:** same behavior as **`push`** on the branch you select.

If any of the three secrets above is unset (e.g. fork **`push`**, or upstream repo before secrets are configured), **`validate`** completes with a **notice** and skips checkout/CLI so CI stays green; **`deploy`** does not run.

**How CI gets a real connection:** the workflow runs **`powersync pull instance`** using **`POWERSYNC_*`** secrets. The CLI joins **`--directory`** with **`process.cwd()`**, so the job **`cd`s into a temp directory** and passes **`--directory=.`** (same pattern you should use locally). That downloads Cloud’s **`service.yaml`**, then copies **`packages/powersync/sync-rules.yaml`** over **`sync-config.yaml`** and runs **`validate`** / **`deploy sync-config`**.

Repository secrets are documented under **[DEV_SETUP.md → PowerSync sync config (GitHub Actions)](DEV_SETUP.md#powersync-sync-config-github-actions)** (`POWERSYNC_ADMIN_TOKEN`, `POWERSYNC_INSTANCE_ID`, `POWERSYNC_PROJECT_ID`, optional `POWERSYNC_ORG_ID`).

---

## Cloud-only development (no Docker on your machine)

**You do not need Docker** for the recommended path—only **`db push`** and **`gen types --linked`** against Supabase Cloud. **Docker** in this repo only appears **inside** certain GitHub Actions jobs, not as a requirement for your computer.

---

## Instructions for AI assistants (Cursor, Copilot, etc.)

1. **Assume Supabase Cloud** for development—not `supabase start` on Sarah’s laptop unless she says so.

2. **Recommended migration flow for Sarah:** when changing **`supabase/migrations/`**, tell her—in the **same message**—to **`db push`** to cloud **only when the migration SQL is stable** (e.g. after Copilot/PR review), **then** **`gen types --linked`** + Prettier **then** commit **both** migration and `packages/supabase/src/lib/database.types.ts` **before** or as part of merge (see **Recommended workflow** and **Revising a migration already pushed** above). **GitHub Actions** still runs `db push` on `main` as a backstop. **Do not** imply she must `db push` immediately on first draft if reviews may rewrite the same file.

   **Critical review-phase rule:** while Sarah is still iterating on Copilot/PR review feedback, assume migrations have **not** been pushed yet and **modify existing migration file(s) only**. **Do not create new migration files during review iterations** unless Sarah explicitly asks.

3. **Never imply `supabase db reset` affects cloud.** Local Docker only (or CI-only).

4. **Say explicitly** when she must use **her terminal** (CLI login, link, `db push`, `gen types`) vs what CI does after merge.

5. **Do not** imply a bot commits `database.types.ts`.

6. **Ask before changing** `.github/workflows/*` deployment or secrets without her approval (PowerSync sync deploy is documented in **PowerSync Sync Streams** above and uses **`powersync-sync-config.yml`**).

7. When **`database.types.ts`** or **`supabase/migrations/`** are involved, point to **`gen types --linked`** + Prettier (see **Recommended workflow** above) and that **[`.github/workflows/supabase-migrations.yml`](../.github/workflows/supabase-migrations.yml)** verifies on `main` after `db push`. **Do not** suggest Docker on her laptop unless she asks.

---

## Related files

| Topic                         | Location                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| CLI install, link, secrets    | [DEV_SETUP.md §4](DEV_SETUP.md#4-supabase-database-migrations-cloud-cli-and-ci)                    |
| Migrations + verify on `main` | [`.github/workflows/supabase-migrations.yml`](../.github/workflows/supabase-migrations.yml)        |
| PowerSync sync YAML on `main` | [`.github/workflows/powersync-sync-config.yml`](../.github/workflows/powersync-sync-config.yml)    |
| PR types check                | [`.github/workflows/supabase-db-types-pr.yml`](../.github/workflows/supabase-db-types-pr.yml)      |
| App env vars                  | [`packages/supabase/README.md`](../packages/supabase/README.md), [`.env.example`](../.env.example) |
