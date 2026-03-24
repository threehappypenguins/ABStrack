# Development environment setup

This guide covers getting the ABStrack monorepo running on a new machine and onboarding a teammate. The project is an [Nx](https://nx.dev) workspace with **Next.js** apps (`web`, `practitioner`), an **Expo** app (`mobile`), and shared packages under `packages/`.

---

## 1. Prerequisites

### All platforms

| Requirement | Notes |
|-------------|--------|
| **Git** | For clone and version control. |
| **Node.js 20.x** | Matches [CI](../.github/workflows/ci.yml). Use [nodejs.org](https://nodejs.org/) or a version manager (see below). |
| **pnpm 10.29.2** | Matches CI. Install via [pnpm.io/installation](https://pnpm.io/installation) or Corepack (below). |

Optional but common:

| Tool | When you need it |
|------|------------------|
| **Android Studio** (with SDK + emulator) | Running the mobile app on Android. |
| **Xcode** (macOS only) | Running the mobile app on the iOS Simulator. |
| **Watchman** (macOS/Linux) | Can improve Metro file-watching for React Native; not strictly required. |

### macOS and Linux (including Ubuntu)

1. Install **Node.js 20** — e.g. [nvm](https://github.com/nvm-sh/nvm), [fnm](https://github.com/Schniz/fnm), [mise](https://mise.jdx.dev/), or your distro’s packages (ensure the major version is 20).
2. Enable **Corepack** (ships with Node) and activate the repo’s pnpm version:

   ```bash
   corepack enable
   corepack prepare pnpm@10.29.2 --activate
   ```

   Alternatively install pnpm globally as documented on [pnpm.io](https://pnpm.io/installation).

3. Confirm versions:

   ```bash
   node -v    # expect v20.x.x
   pnpm -v    # expect 10.29.2
   ```

### Windows

1. Install **Node.js 20 LTS** from [nodejs.org](https://nodejs.org/) (includes **npm**).
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

| App | File (create locally) | Purpose |
|-----|------------------------|---------|
| User web (`apps/web`) | `apps/web/.env.local` | Next.js: URL + publishable (or legacy anon) key. |
| Practitioner web (`apps/practitioner`) | `apps/practitioner/.env.local` | Same pattern as `web`. |
| Mobile (`apps/mobile`) | `apps/mobile/.env` | Expo / Metro: `EXPO_PUBLIC_*` variables. |

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

**What to do:** Open `apps/mobile/.env` and **delete the `NEXT_PUBLIC_*` lines** (and any Next-only comments you do not need). Keep **`EXPO_PUBLIC_SUPABASE_URL`** and **`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`** (or legacy anon equivalents) with the **same values** you use on web — only the prefix changes. Leaving `NEXT_PUBLIC_*` in place does not break Metro, but it confuses the Expo CLI log (`env: export NEXT_PUBLIC_...`) and makes it look like the mobile app uses those variables.

### Fill in real values

1. Open each of the three new files in an editor.
2. Remove or comment out variables you do not use yet; **uncomment and set** at minimum:
   - **Next apps:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` if you have not migrated).
   - **Mobile:** only the **`EXPO_PUBLIC_*`** pair above (after trimming any copied `NEXT_PUBLIC_*` lines — see previous subsection).
3. Optional server-only keys (`SUPABASE_SECRET_KEY` or legacy `SUPABASE_SERVICE_ROLE_KEY`) belong only in **server** contexts (e.g. Next Route Handlers), never in `EXPO_PUBLIC_*` or client bundles.

Get URLs and keys from the [Supabase dashboard](https://supabase.com/dashboard): **Project Settings → API** / **API Keys**, or **Integrations → Data API** for the API URL. For Email/password auth (PRD), enable **Authentication → Providers → Email**.

### Sanity check

- `.gitignore` already excludes `.env`, `.env.local`, and `.env.*.local`; your copies should not appear in `git status` as new tracked files (if Git proposes adding them, stop and check paths).
- The template contains comments; it is normal for `web` and `practitioner` to include the same `NEXT_PUBLIC_*` values, and `mobile` the same logical values under `EXPO_PUBLIC_*`.

---

## 4. Verify the workspace

From the repo root, align with CI:

### macOS / Linux / Windows (same commands)

```bash
pnpm exec nx run-many -t lint test typecheck
pnpm exec nx run-many -t build --exclude=@abstrack/mobile
```

Env vars are **not** required for these tasks unless code reads them at import time. If you add or change dependencies under `packages/*`, run `pnpm install` and commit the updated `pnpm-lock.yaml` so `pnpm install --frozen-lockfile` (CI) keeps working.

---

## 5. Run applications locally

Run from the **repository root** unless noted.

| Goal | Command |
|------|---------|
| User web app | `pnpm exec nx dev web` |
| Practitioner web app | `pnpm exec nx dev practitioner` |
| Mobile (Expo) | `pnpm exec nx start mobile` |

Default ports depend on Nx/Next/Expo; watch the terminal output. For mobile, use Expo Go or an emulator after `nx start mobile`.

Useful references:

- [Nx run-many](https://nx.dev/nx-api/nx/documents/run-many)
- [Next.js environment variables](https://nextjs.org/docs/app/building-your-application/configuring/environment-variables)
- [Expo environment variables](https://docs.expo.dev/guides/environment-variables/)

---

## 6. Optional tooling

| Area | Notes |
|------|--------|
| **Nx Console** | Editor plugin for tasks and graph: [Nx editor setup](https://nx.dev/getting-started/editor-setup). |
| **Playwright (e2e)** | Projects `web-e2e` and `practitioner-e2e`; run when you need end-to-end tests (browsers may need a one-time install: `pnpm exec playwright install`). |
| **Docker** | Not required for the default Node/Nx workflow unless you add containerized services later. |

---

## 7. Troubleshooting

| Symptom | Things to try |
|---------|----------------|
| `pnpm: command not found` | Ensure Corepack prepared pnpm, or install pnpm globally; reopen the terminal. |
| Wrong Node version | Switch to Node 20 with your version manager; confirm with `node -v`. |
| Next.js cannot see Supabase env | Confirm variables are in **`apps/<app>/.env.local`**, not only the repo root. Restart the dev server after changes. |
| Expo cannot see variables | Use `EXPO_PUBLIC_*` names in **`apps/mobile/.env`**; restart Metro / clear cache if needed (`pnpm exec nx start mobile` with Expo’s cache clear options if documented for your setup). |
| `pnpm install` fails on Windows | Run shell as admin once if permission errors; check antivirus locking `node_modules`; try deleting `node_modules` and reinstalling. |
| Path errors on Windows | Use forward slashes in copied commands where supported, or use the `copy` / `Copy-Item` examples above with backslashes in `cmd`. |

---

## 8. Checklist

- [ ] Node.js 20 and pnpm 10.29.2 installed
- [ ] Repository cloned
- [ ] `pnpm install --frozen-lockfile` succeeded
- [ ] `apps/web/.env.local` and `apps/practitioner/.env.local` created from `.env.example` and filled with project credentials
- [ ] `apps/mobile/.env` created from `.env.example`, **trimmed** to `EXPO_PUBLIC_*` only, and filled with real values
- [ ] `pnpm exec nx run-many -t lint test typecheck` (and build excluding mobile if you match CI) passes
- [ ] `pnpm exec nx dev web` (and/or other apps) runs as expected

For product context and milestones, see [PRD.md](PRD.md) and [ROADMAP.md](ROADMAP.md).
