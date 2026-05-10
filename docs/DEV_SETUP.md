# Development environment setup

This guide covers getting the ABStrack monorepo running on a new machine and onboarding a teammate. The project is an [Nx](https://nx.dev) workspace with **Next.js** apps (`web`, `practitioner`), an **Expo** app (`mobile`), and shared packages under `packages/`.

---

## 1. Prerequisites

### All platforms

| Requirement           | Notes                                                                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Git**               | For clone and version control.                                                                                                                                                      |
| **Node.js ≥ 20.19.0** | Matches [CI](../.github/workflows/ci.yml) and `engines` in the repo root `package.json` (`@noble/*` 2.2.x). Use [nodejs.org](https://nodejs.org/) or a version manager (see below). |
| **pnpm 10.29.2**      | Matches CI. Install via [pnpm.io/installation](https://pnpm.io/installation) or Corepack (below).                                                                                   |

Optional but common:

| Tool                                     | When you need it                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| **Android Studio** (with SDK + emulator) | Running the mobile app on Android.                                       |
| **Xcode** (macOS only)                   | Running the mobile app on the iOS Simulator.                             |
| **Watchman** (macOS/Linux)               | Can improve Metro file-watching for React Native; not strictly required. |

### macOS and Linux (including Ubuntu)

1. Install **Node.js 20.19 or newer** (20.x LTS line) — e.g. [nvm](https://github.com/nvm-sh/nvm) with `.nvmrc` in the repo root, [fnm](https://github.com/Schniz/fnm), [mise](https://mise.jdx.dev/), or your distro’s packages.
2. Enable **Corepack** (ships with Node) and activate the repo’s pnpm version:

   ```bash
   corepack enable
   corepack prepare pnpm@10.29.2 --activate
   ```

   Alternatively install pnpm globally as documented on [pnpm.io](https://pnpm.io/installation).

3. Confirm versions:

   ```bash
   node -v    # expect v20.19.0 or newer (see root package.json engines)
   pnpm -v    # expect 10.29.2
   ```

### Windows

1. Install **Node.js 20.19+ LTS** from [nodejs.org](https://nodejs.org/) (includes **npm**).
2. Open **PowerShell** or **Command Prompt** as appropriate and enable Corepack, then pnpm:

   ```powershell
   corepack enable
   corepack prepare pnpm@10.29.2 --activate
   ```

   If `corepack` is not recognized, use an elevated shell or install pnpm with npm:

   ```powershell
   npm install -g pnpm@10.29.2
   ```

3. Confirm:

   ```powershell
   node -v
   pnpm -v
   ```

**Windows notes**

- Prefer **PowerShell** or **Git Bash** for commands in this doc. Adjust paths if you use `cmd.exe` (copy commands for env files are in [§3](#3-environment-variables-supabase-and-apps)).
- Long paths: if installs fail with path-length errors, enable long paths in Windows or clone the repo closer to `C:\dev`.
- Line endings: Git’s `core.autocrlf` may change newlines in checked-in files; `.env.local` and `.env` are **not** committed—if a tool misreads env files, save them with **LF** line endings.

---

## 2. Clone and install dependencies

From the directory where you keep projects:

### macOS / Linux

```bash
git clone https://github.com/sarahpoulin/ABStrack.git ABStrack
cd ABStrack
pnpm install --frozen-lockfile
```

Use `pnpm install` without `--frozen-lockfile` only when you intentionally change dependencies.

To add a **dev dependency to the workspace root** (shared tooling), run from the repo root with pnpm’s explicit root flag, e.g. `pnpm add -D <package>@latest -w`. Without `-w` / `--workspace-root`, pnpm refuses root installs so you do not add packages to the root by mistake.

### Windows (PowerShell)

```powershell
git clone https://github.com/sarahpoulin/ABStrack.git ABStrack
cd ABStrack
pnpm install --frozen-lockfile
```

---

## 3. Environment variables (Supabase and apps)

Secrets must **never** be committed. The repo root [`.env.example`](../.env.example) is the **template only** (safe to commit). Each runtime loads env files from **inside the app folder**, not from the monorepo root.

### What each app reads

| App                                    | File (create locally)          | Purpose                                              |
| -------------------------------------- | ------------------------------ | ---------------------------------------------------- |
| User web (`apps/web`)                  | `apps/web/.env.local`          | Next.js: URL + publishable key (`sb_publishable_…`). |
| Practitioner web (`apps/practitioner`) | `apps/practitioner/.env.local` | Same pattern as `web`.                               |
| Mobile (`apps/mobile`)                 | `apps/mobile/.env`             | Expo / Metro: `EXPO_PUBLIC_*` variables.             |

Next.js documents `.env.local` in each app directory. Expo picks up `.env` under `apps/mobile/`. See also [`packages/supabase/README.md`](../packages/supabase/README.md) for dashboard ↔ variable mapping.

### Create the three files from the template

Run these from the **repository root** (`ABStrack/`), after clone.

#### macOS / Linux (bash)

```bash
cp .env.example apps/web/.env.local
cp .env.example apps/practitioner/.env.local
cp .env.example apps/mobile/.env
```

#### Windows (PowerShell)

```powershell
Copy-Item .env.example apps/web/.env.local
Copy-Item .env.example apps/practitioner/.env.local
Copy-Item .env.example apps/mobile/.env
```

#### Windows (Command Prompt)

```cmd
copy .env.example apps\web\.env.local
copy .env.example apps\practitioner\.env.local
copy .env.example apps\mobile\.env
```

### Mobile: only `EXPO_PUBLIC_*` matters

If you copied the full `.env.example` into `apps/mobile/.env`, that file also contains `NEXT_PUBLIC_*` variables meant for Next.js. **Expo does not load those into your app** the way Next does — only names starting with `EXPO_PUBLIC_` are embedded in the Metro bundle ([Expo env docs](https://docs.expo.dev/guides/environment-variables/)).

**What to do:** Open `apps/mobile/.env` and **delete the `NEXT_PUBLIC_*` lines** (and any Next-only comments you do not need). Keep **`EXPO_PUBLIC_SUPABASE_URL`** and **`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`** with the **same values** you use on web — only the prefix changes. Leaving `NEXT_PUBLIC_*` in place does not break Metro, but it confuses the Expo CLI log (`env: export NEXT_PUBLIC_...`) and makes it look like the mobile app uses those variables.

### Fill in real values

1. Open each of the three new files in an editor.
2. Remove or comment out variables you do not use yet; **uncomment and set** at minimum:
   - **Next apps:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
   - **Mobile:** only the **`EXPO_PUBLIC_*`** pair above (after trimming any copied `NEXT_PUBLIC_*` lines — see previous subsection).
3. Optional server-only **`SUPABASE_SECRET_KEY`** (`sb_secret_...`) belongs only in **server** contexts (e.g. Next Route Handlers), never in `EXPO_PUBLIC_*` or client bundles. `@abstrack/supabase/admin` does not use legacy JWT `service_role` env vars. In the [Supabase dashboard](https://supabase.com/dashboard), the secret key is listed under **Settings → API Keys** (secret key, not publishable).

Get URLs and publishable keys from the [Supabase dashboard](https://supabase.com/dashboard): **Settings → API Keys**, or **Integrations → Data API** for the API URL. For Email/password auth (PRD), enable **Authentication → Providers → Email**.

### Sanity check

- `.gitignore` already excludes `.env`, `.env.local`, and `.env.*.local`; your copies should not appear in `git status` as new tracked files (if Git proposes adding them, stop and check paths).
- The template contains comments; it is normal for `web` and `practitioner` to include the same `NEXT_PUBLIC_*` values, and `mobile` the same logical values under `EXPO_PUBLIC_*`.

---

## 4. Supabase database migrations (cloud CLI and CI)

**Supabase workflow (cloud + CLI + GitHub Actions):** **[SUPABASE_CLOUD_DEVELOPER.md](SUPABASE_CLOUD_DEVELOPER.md)** — keep **Actions `db push` on `main`**; for a **single PR** with migrations + types, run **`db push`** and **`gen types --linked`** from your laptop **before merge**. **AI assistants:** **[AGENTS.md](../AGENTS.md)**.

App environment variables (`NEXT_PUBLIC_SUPABASE_URL`, keys) let clients call the **Data API**; they do **not** apply SQL from the repo. Schema changes live in [`supabase/migrations/`](../supabase/migrations/) and must be applied to your hosted Postgres with the **Supabase CLI** (or an equivalent process).

Official reference: [Managing Environments](https://supabase.com/docs/guides/cli/managing-environments) (CLI + GitHub Actions).

### Install and sign in to the CLI

From the repo root (or install the CLI globally per [Supabase CLI docs](https://supabase.com/docs/guides/cli)):

```bash
pnpm dlx supabase --version
pnpm dlx supabase login
```

`supabase login` opens a browser or accepts a **personal access token** from the dashboard: [Account → Access Tokens](https://supabase.com/dashboard/account/tokens). The CLI stores credentials for local use; it is not the same key as your app’s publishable Data API key.

### Link this repo to your Supabase project

You need your **project ref** (the id in the dashboard URL: `https://supabase.com/dashboard/project/<project-ref>`).

```bash
pnpm dlx supabase link --project-ref <project-ref>
```

The CLI will prompt for the **database password** unless you set it in the environment (useful for scripts and CI):

```bash
export SUPABASE_DB_PASSWORD='<database-password>'
pnpm dlx supabase link --project-ref <project-ref>
```

Find or reset the database password in the [Supabase dashboard](https://supabase.com/dashboard) under **Database → Settings** for your project, or open **Connect** at the top of the project page to view connection strings and the `postgres` password. It is **not** the same as **API Keys** or **JWT Keys** under Project Settings.

Linking writes local metadata (under `supabase/`, gitignored where appropriate) so commands like `db push` know which remote database to target.

### Push pending migrations to Supabase Cloud

After new files exist in `supabase/migrations/`, apply them to the linked project:

```bash
pnpm dlx supabase db push
```

**Recommended with this repo:** run **`db push`** from your laptop **before merging** a migration PR, then **`gen types typescript --linked`** and update `packages/supabase/src/lib/database.types.ts` (see **[SUPABASE_CLOUD_DEVELOPER.md](SUPABASE_CLOUD_DEVELOPER.md)**). **GitHub Actions** still runs **`db push`** on **`main`** after merge as a backstop.

Useful variants:

- **`pnpm dlx supabase db push --dry-run`** — prints which migrations would run without applying them (good for checks before merge).
- **`pnpm dlx supabase migration list`** — compare local and remote migration history.

`supabase db reset` (recreate local DB + run migrations + `seed.sql`) is for **local** development with Docker and the Supabase stack; it does not run against your online project. **`seed.sql`** is not applied to production unless you intentionally use a seeding path (the default cloud workflow is migrations only).

### GitHub Actions (this repository)

The workflow [`.github/workflows/supabase-migrations.yml`](../.github/workflows/supabase-migrations.yml) uses the same non-interactive variables as the [Supabase managing environments](https://supabase.com/docs/guides/cli/managing-environments) guide:

| Secret                  | Purpose                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `SUPABASE_ACCESS_TOKEN` | Personal access token for the CLI (`supabase login` equivalent).                                       |
| `SUPABASE_PROJECT_ID`   | Project ref string (same as `supabase link --project-ref`).                                            |
| `SUPABASE_DB_PASSWORD`  | Postgres password for the `postgres` role (from **Connect** or **Database → Settings**; see §4 above). |

Add these under **Repository → Settings → Secrets and variables → Actions**. The workflow runs **`supabase db push --dry-run`** on pull requests that change migration files (same-repo branches only; **fork PRs do not receive secrets**, so migrate checks are skipped there), and **`supabase db push`** on pushes to `main` when migration paths change. You can also run the workflow manually (**Actions → Supabase migrations → Run workflow**).

### PowerSync sync config (GitHub Actions)

[`.github/workflows/powersync-sync-config.yml`](../.github/workflows/powersync-sync-config.yml) runs **`powersync pull instance`** then full **`powersync validate`** on same-repo PRs and on pushes when **`packages/powersync/sync-rules.yaml`** (or that workflow) changes; **`powersync deploy sync-config`** runs on **`main`** after **`validate`** succeeds. Details and manual CLI: **[SUPABASE_CLOUD_DEVELOPER.md — PowerSync Sync Streams](SUPABASE_CLOUD_DEVELOPER.md#powersync-sync-streams-packagespowersyncsync-rulesyaml)**.

| Secret                  | Purpose                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `POWERSYNC_ADMIN_TOKEN` | PowerSync personal access token (Dashboard → Access tokens). The CLI reads it as **`PS_ADMIN_TOKEN`**. |
| `POWERSYNC_INSTANCE_ID` | Target Cloud **instance** id (CLI / Dashboard). Mapped to **`INSTANCE_ID`** in the workflow.           |
| `POWERSYNC_PROJECT_ID`  | PowerSync **project** id. Mapped to **`PROJECT_ID`**.                                                  |
| `POWERSYNC_ORG_ID`      | Optional. Set only if your PAT spans multiple orgs (mapped to **`ORG_ID`**).                           |

Fork PRs do not receive these secrets; the validate job is skipped there (same pattern as Supabase migrations).

**Types file:** [`.github/workflows/supabase-migrations.yml`](../.github/workflows/supabase-migrations.yml) runs **`supabase gen types typescript --linked`** after `db push` on `main` only to **verify** the committed `packages/supabase/src/lib/database.types.ts` matches cloud—it **does not commit**. If it fails, follow **[SUPABASE_CLOUD_DEVELOPER.md](SUPABASE_CLOUD_DEVELOPER.md)**. [`.github/workflows/supabase-db-types-pr.yml`](../.github/workflows/supabase-db-types-pr.yml) may compare types to migration SQL on PRs using a **CI-only** Docker stack.

If you later use **separate staging and production** projects, duplicate the pattern with different secrets (for example `STAGING_PROJECT_ID` / `PRODUCTION_PROJECT_ID`) as in the [demo workflow](https://supabase.com/docs/guides/cli/managing-environments#configure-github-actions).

---

## 5. Verify the workspace

From the repo root, align with CI:

### macOS / Linux / Windows (same commands)

```bash
pnpm exec nx run-many -t lint test typecheck
pnpm exec nx run-many -t build --exclude=@abstrack/mobile
```

Env vars are **not** required for these tasks unless code reads them at import time. If you add or change dependencies under `packages/*`, run `pnpm install` and commit the updated `pnpm-lock.yaml` so `pnpm install --frozen-lockfile` (CI) keeps working.

---

## 6. Run applications locally

Run from the **repository root** unless noted.

| Goal                 | Command                         |
| -------------------- | ------------------------------- |
| User web app         | `pnpm exec nx dev web`          |
| Practitioner web app | `pnpm exec nx dev practitioner` |
| Mobile (Expo)        | `pnpm exec nx start mobile`     |

Easier:

| Goal                 | Command             |
| -------------------- | ------------------- |
| User web app         | `pnpm web`          |
| Practitioner web app | `pnpm practitioner` |
| Mobile (Expo)        | `pnpm mobile`       |

Default ports depend on Nx/Next/Expo; watch the terminal output. For **mobile**, the app includes **native-only** dependencies (`@op-engineering/op-sqlite` / PowerSync SQLCipher). They are **not** in the store **Expo Go** app — opening the dev-server QR code in Expo Go often fails at runtime with errors like **“Base module not found”** (pod/Gradle hints in the message are a red herring on a physical device). Use one of: **(1)** a **development build** installed on the device ([`apps/mobile/eas.json`](../apps/mobile/eas.json) profile `development` has `developmentClient: true` — build with EAS and install that APK/IPA, then open the same Metro URL/QR from **that** dev client), **(2)** from the repo root **`pnpm ios`** or **`pnpm android`** (runs `expo run:ios` / `expo run:android` in `apps/mobile` with a USB device or emulator), or **(3)** the same against a simulator. Do **not** rely on Expo Go for this repo’s mobile app.

Useful references:

- [Nx run-many](https://nx.dev/nx-api/nx/documents/run-many)
- [Next.js environment variables](https://nextjs.org/docs/app/building-your-application/configuring/environment-variables)
- [Expo environment variables](https://docs.expo.dev/guides/environment-variables/)

---

## 7. Upgrading React (e.g. to 19.2+)

The workspace pins **React 19.1.x** to match **Expo SDK 54** and to stay aligned with **`react-dom`**, **`react-test-renderer`**, and **`@types/react` / `@types/react-dom`**. If you move to a newer React minor (for example **19.2+**), update **everything below in one commit** so you do not get peer warnings or type/runtime skew.

1. **Runtime (exact pins today — bump together)**  
   In the root [`package.json`](../package.json) `dependencies`: `react`, `react-dom`.  
   In [`apps/web/package.json`](../apps/web/package.json) and [`apps/practitioner/package.json`](../apps/practitioner/package.json): same `react` / `react-dom` versions as the root (or whatever range you standardize on).  
   In [`apps/mobile/package.json`](../apps/mobile/package.json): `react`, `react-dom` (Expo’s [supported versions](https://docs.expo.dev/versions/latest/) still apply — prefer `npx expo install react react-dom` from `apps/mobile` when upgrading the mobile stack).

2. **Tests**  
   Root `devDependencies`: `react-test-renderer` must match the same React minor as `react` (same patch is ideal).

3. **TypeScript types**  
   Root `devDependencies`: `@types/react` and `@types/react-dom` — keep them on the **same minor** as `react` (today the repo uses `~19.1.0`).

4. **pnpm overrides**  
   The root `package.json` includes `pnpm.overrides` for `@types/react` and `@types/react-dom` so transitive packages (e.g. React Native) cannot pull a newer types minor. When you upgrade React typings to **19.2.x**, update those override ranges (or remove overrides if you no longer need them).

5. **Lockfile**  
   Run `pnpm install`, fix any peer warnings, run `pnpm exec nx run-many -t lint test typecheck` (and mobile as needed), then commit **`package.json`** files and **`pnpm-lock.yaml`** together.

---

## 8. Optional tooling

| Area                 | Notes                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nx Console**       | Editor plugin for tasks and graph: [Nx editor setup](https://nx.dev/getting-started/editor-setup).                                                    |
| **Playwright (e2e)** | Projects `web-e2e` and `practitioner-e2e`; run when you need end-to-end tests (browsers may need a one-time install: `pnpm exec playwright install`). |
| **Docker**           | Not required for the default Node/Nx workflow unless you add containerized services later.                                                            |

---

## 9. Troubleshooting

| Symptom                                 | Things to try                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm: command not found`               | Ensure Corepack prepared pnpm, or install pnpm globally; reopen the terminal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Wrong Node version                      | Switch to Node 20 with your version manager; confirm with `node -v`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Next.js cannot see Supabase env         | Confirm variables are in **`apps/<app>/.env.local`**, not only the repo root. Restart the dev server after changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Expo cannot see variables               | Use `EXPO_PUBLIC_*` names in **`apps/mobile/.env`**; restart Metro / clear cache if needed (`pnpm exec nx start mobile` with Expo’s cache clear options if documented for your setup).                                                                                                                                                                                                                                                                                                                                                                                                    |
| `supabase link` / `db push` fails in CI | Confirm **Actions secrets** match [§4](#4-supabase-database-migrations-cloud-cli-and-ci) (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD`). The database password is the **Postgres** password from **Connect** or **Database → Settings**, not the Data API publishable key.                                                                                                                                                                                                                                                                                      |
| Fork PR: migration workflow skipped     | Expected: GitHub does not expose repository secrets to workflows from forks. Run checks on a branch in the main repo or apply migrations manually after merge.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| PowerSync workflow fails / skipped      | Confirm **`POWERSYNC_*`** secrets in § [GitHub Actions — PowerSync sync config](#powersync-sync-config-github-actions). If **`POWERSYNC_ADMIN_TOKEN`**, **`POWERSYNC_INSTANCE_ID`**, and **`POWERSYNC_PROJECT_ID`** are unset, the workflow **succeeds with a notice** and skips CLI validate/deploy (no red failures). Same-repo PRs and branch pushes run validate when secrets exist; **`main`** push deploys **`sync-config`** only after a real validate. See **[SUPABASE_CLOUD_DEVELOPER.md](SUPABASE_CLOUD_DEVELOPER.md#powersync-sync-streams-packagespowersyncsync-rulesyaml)**. |
| `pnpm install` fails on Windows         | Run shell as admin once if permission errors; check antivirus locking `node_modules`; try deleting `node_modules` and reinstalling.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Path errors on Windows                  | Use forward slashes in copied commands where supported, or use the `copy` / `Copy-Item` examples above with backslashes in `cmd`.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Mobile: “Base module not found” (Expo)  | You opened the bundle in **Expo Go**; this project needs a **development build** or `expo run:*` install because of **OP-SQLite / PowerSync** native code. Install the dev client from an EAS **`development`** build (see `apps/mobile/eas.json`), or from the repo root run **`pnpm android`** / **`pnpm ios`** on a device/emulator. Then connect to Metro from **that** app, not Expo Go. Clearing Gradle or `pod install` on the laptop does not fix Expo Go missing modules. See [§6](#6-run-applications-locally) above.                                                           |

---

## 10. Checklist

- [ ] Node.js 20 and pnpm 10.29.2 installed
- [ ] Repository cloned
- [ ] `pnpm install --frozen-lockfile` succeeded
- [ ] `apps/web/.env.local` and `apps/practitioner/.env.local` created from `.env.example` and filled with project credentials
- [ ] `apps/mobile/.env` created from `.env.example`, **trimmed** to `EXPO_PUBLIC_*` only, and filled with real values
- [ ] Supabase CLI: `login`, `link`, and for migration PRs **`db push` + `gen types --linked`** + Prettier before merge ([§4](#4-supabase-database-migrations-cloud-cli-and-ci), [SUPABASE_CLOUD_DEVELOPER.md](SUPABASE_CLOUD_DEVELOPER.md))
- [ ] If using GitHub Actions for migrations: repository secrets set (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD`) per [§4](#4-supabase-database-migrations-cloud-cli-and-ci)
- [ ] If using GitHub Actions for PowerSync: `POWERSYNC_ADMIN_TOKEN`, `POWERSYNC_INSTANCE_ID`, `POWERSYNC_PROJECT_ID` (and `POWERSYNC_ORG_ID` if needed) per [PowerSync sync config](#powersync-sync-config-github-actions)
- [ ] `pnpm exec nx run-many -t lint test typecheck` (and build excluding mobile if you match CI) passes
- [ ] `pnpm exec nx dev web` (and/or other apps) runs as expected

For product context and milestones, see [PRD.md](PRD.md) and [ROADMAP.md](ROADMAP.md).
