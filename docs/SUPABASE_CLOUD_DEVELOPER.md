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

## Dev cleanup: `chart_snapshots` (cloud SQL Editor)

Migration **`20260524140000_chart_snapshots.sql`** makes shares **append-only for app clients** (`authenticated` has no `DELETE`). During development you will still need to remove test shares on **Supabase Cloud**.

**Use the dashboard SQL Editor** on your linked project (runs as `postgres`, a **trusted** session per `profiles_trusted_session_for_app_role()`). Table Editor may still refuse delete depending on which role Studio uses; SQL Editor is the supported cleanup path.

After that migration is applied to cloud (`db push`), run one of the following in **SQL Editor**:

```sql
-- One snapshot
DELETE FROM public.chart_snapshots
WHERE id = '00000000-0000-0000-0000-000000000000';

-- All shares for one patient
DELETE FROM public.chart_snapshots
WHERE patient_user_id = '00000000-0000-0000-0000-000000000000';

-- All rows (throwaway dev only)
DELETE FROM public.chart_snapshots;
```

Or use the maintenance helper from the same migration (trusted sessions only; not granted to `authenticated`):

```sql
-- Returns number of rows deleted
SELECT public.delete_chart_snapshots_maintenance(
  '00000000-0000-0000-0000-000000000000'::uuid,  -- p_snapshot_id (or NULL)
  NULL::uuid                                       -- p_patient_user_id (or NULL)
);

-- All rows for a patient: (NULL, patient_user_id)
-- All rows: (NULL, NULL)
```

If cleanup from an app or Studio session fails, check the exact error from `chart_snapshots_append_only_guard`:

- **Untrusted `DELETE`:** `chart_snapshots is append-only` (hint: _Use the SQL Editor as postgres, or call delete_chart_snapshots_maintenance from a trusted session._). The session is not trusted—for example Table Editor as `dashboard_user`. Use **SQL Editor** as `postgres`, not Table Editor.
- **Untrusted `UPDATE`:** `chart_snapshots is append-only except seen_by_patient_at` (patients may only mark seen via `mark_chart_snapshot_seen`).

**Before the migration is on cloud:** `chart_snapshots` does not exist yet (or migration `20260524130000` still blocks all `DELETE` with `chart_snapshots is append-only`). Finish review on the migration file, then `db push` once before relying on the commands above.

---

## If you skip local `db push` before merge

Then the migration hits cloud when **CI runs `db push` on `main`** after merge. **`gen types --linked`** only works **after** that. You would need to **regenerate types and commit** in a **follow-up** commit (or PR) unless the [PR types workflow](../.github/workflows/supabase-db-types-pr.yml) already forced an updated file via its Docker-based check.

---

## One-time setup checklist

1. **GitHub Actions:** repository secrets for [`.github/workflows/supabase-migrations.yml`](../.github/workflows/supabase-migrations.yml)—see [DEV_SETUP.md §4](DEV_SETUP.md#4-supabase-database-migrations-cloud-cli-and-ci) (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD`).
2. **GitHub Actions (PowerSync):** optional but recommended if you use PowerSync Cloud—secrets for [`.github/workflows/powersync-sync-config.yml`](../.github/workflows/powersync-sync-config.yml)—see [DEV_SETUP.md → PowerSync sync config](DEV_SETUP.md#powersync-sync-config-github-actions).
3. **Your laptop (for the recommended migration flow):** `pnpm dlx supabase login`, `pnpm dlx supabase link --project-ref <project-ref>`.

---

## Patient caretaker Edge Function (`patient-caretaker-access`)

Product default: **patients and caretakers are mobile-primary** (Expo app in `apps/mobile/`). User web is optional.

Caretaker **email invites** use `auth.admin.inviteUserByEmail`. **`redirectTo`** is trimmed **`ABSTRACK_CARETAKER_INVITE_REDIRECT_TO`** when set (this repo uses **`abstrack:///caretaker-invite`**, matching Expo **`scheme`: `abstrack`** in `apps/mobile/app.json`). If that secret is unset, the function falls back to **`{trimmed-validated-origin}/auth/callback?next=/caretaker/join`** from **`ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN`** (must be absolute `http://` or `https://`; trailing slash and surrounding whitespace are normalized). See `supabase/functions/patient-caretaker-access/index.ts`.

**Invitee completion:** Mobile `apps/mobile/src/app/App.tsx` handles **`abstrack:///caretaker-invite?code=…`** and, when **`EXPO_PUBLIC_USER_WEB_ORIGIN`** matches the invite **`redirectTo`** origin, **`http(s)://…/auth/callback?…&next=/caretaker/join`** (Universal Links / App Links target **`/auth/callback` only** — not **`/caretaker/join`**, which has no `code` after the web exchange). If **`/caretaker/join`** still opens the app without a `code`, the app shows a short “continue in browser” message. User web **`/caretaker/join`** still applies when the session completes in the browser.

### HTTPS invite → same link opens browser (desktop) and native app (phone)

When invite emails use **`ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN`** (HTTPS **`…/auth/callback?next=/caretaker/join`**), you need **iOS Universal Links** + **Android App Links** so the **same** URL opens the **installed app** on a phone instead of only Safari/Chrome. This repo wires the native side and verification files as follows.

1. **Mobile env** `EXPO_PUBLIC_USER_WEB_ORIGIN` — same origin as the Edge secret **`ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN`** (e.g. `https://app.example.com`). Used at build time in `apps/mobile/app.config.ts` for `associatedDomains` / `intentFilters`. Rebuild native after changing it (`pnpm android` / `pnpm ios` from `apps/mobile/`, or your CI native build).
2. **User web (Next.js)** — public routes (no secrets in the JSON body):
   - **`/.well-known/apple-app-site-association`** — set server env **`APPLE_APP_SITE_ASSOCIATION_TEAM_ID`** (and optional **`APPLE_IOS_BUNDLE_ID`**, default `com.abstrack.mobile`). Returns **404** until set.
   - **`/.well-known/assetlinks.json`** — set **`ANDROID_APP_LINKS_SHA256_CERT_FINGERPRINTS`** (one or more SHA-256 cert fingerprints; optional **`ANDROID_APPLICATION_ID`**, default `com.abstrack.mobile`). Returns **404** until set.
3. **Verify** over **HTTPS** (no redirects): Apple and Google fetch these paths from your **production** user-web host. See [Expo iOS Universal Links](https://docs.expo.dev/linking/ios-universal-links/) and [Android App Links](https://docs.expo.dev/linking/android-app-links/).

#### Local dev: physical Android + USB (no deploy)

Use this when you test on a **real phone over `adb`**, user web runs on your laptop at **port 3000**, and you are **not** deploying user web yet.

1. **Same origin in two places** (must match exactly, including scheme and port):
   - **`apps/mobile/.env`:** `EXPO_PUBLIC_USER_WEB_ORIGIN=http://localhost:3000`
   - **Supabase Edge secret** **`ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN`:** `http://localhost:3000` (omit **`ABSTRACK_CARETAKER_INVITE_REDIRECT_TO`** if you want the HTTPS invite path for this test).
2. **Supabase Auth → Redirect URLs:** add **`http://localhost:3000/auth/callback`** (invite emails use `…/auth/callback?next=/caretaker/join`).
3. **Port reverse** (so `localhost` on the **phone** reaches Next on the **laptop**):

   ```bash
   adb reverse tcp:3000 tcp:3000
   ```

   Re-run that when you reconnect the device if the reverse mapping drops.

4. Start user web on the host on **port 3000**, then **`pnpm android`** from **`apps/mobile/`** again whenever you change **`EXPO_PUBLIC_USER_WEB_ORIGIN`** (native `intentFilters` / `associatedDomains` are build-time).

**Gmail / Outlook and other mail in-app browsers:** Taps usually open a **built-in browser** on the device, not Chrome. If the Auth **`redirectTo`** from your invite is **`http://localhost:3000/…`**, that is **the phone’s own localhost**, not your laptop—so you see an empty or broken page, not Next on your machine. **`adb reverse tcp:3000 tcp:3000`** only helps when traffic originates from **processes on the phone that honor the reverse**; many mail WebViews do **not** behave like that for invite testing. For **opening the Expo app from an invite on a physical Android device**, use the **mobile-primary** checklist below: Edge secret **`ABSTRACK_CARETAKER_INVITE_REDIRECT_TO`** = **`abstrack:///caretaker-invite`** (and the same value under **Auth → Redirect URLs**). Then, after Supabase verifies the magic link, the user is sent to the **`abstrack:`** URL and Android can route it to **ABStrack** instead of a browser. If you **must** exercise the **HTTPS `/auth/callback`** path from a phone, set **`ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN`** to a **public HTTPS origin** your device can reach (deployed user web or a tunnel such as ngrok), **not** bare `localhost`. Transactional email often wraps the link in a **click-tracking host** (for example Brevo/SendGrid); that is normal—the destination after Supabase’s hop is still governed by **`redirectTo`**.

**Notes:** **`/.well-known/apple-app-site-association`** and **`/.well-known/assetlinks.json`** often stay **404** locally until you set **`APPLE_APP_SITE_ASSOCIATION_TEAM_ID`** / **`ANDROID_APP_LINKS_SHA256_CERT_FINGERPRINTS`** on the Next server—full **verified** App Links against `localhost` is limited; the app still recognizes matching **`http://localhost:3000/auth/callback?…`** URLs in **`App.tsx`** when the OS hands them to the app. For **iOS device** dev without deploy, use a **tunnel or LAN IP** instead of `localhost` (no `adb reverse` on iOS).

### Caretaker invite: Supabase checklist (mobile-primary)

Do **not** put `ABSTRACK_CARETAKER_INVITE_*` in `apps/web/.env.local`; nothing in Next.js reads them. Set them as **Supabase Edge Function secrets** (Dashboard → **Edge Functions** → **Secrets**, project-wide for functions—or CLI `secrets set` for the linked project).

1. **Edge secret** `ABSTRACK_CARETAKER_INVITE_REDIRECT_TO` = **`abstrack:///caretaker-invite`** (exact string; three slashes after `abstrack:`).
2. **Supabase Dashboard → Authentication → URL Configuration → Redirect URLs:** add the **same** value `abstrack:///caretaker-invite` (Auth only allows redirects that are listed here). If the UI rejects it, add a documented wildcard such as `abstrack://**` (see [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)).
3. **Deploy** `patient-caretaker-access` after changing secrets so the function picks them up: `pnpm dlx supabase functions deploy patient-caretaker-access` (from repo root, linked project).

**`ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN` (alternate setup, skip for mobile-primary):** Every invite email must include a Supabase Auth **`redirectTo`**. With **`ABSTRACK_CARETAKER_INVITE_REDIRECT_TO`** set (checklist above), **all** invites use that value—whether the patient sent the invite from **mobile Settings or user web Settings**—because only the Edge Function reads these secrets; Next.js does not override it. Set **`ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN`** **only** when you **omit** **`REDIRECT_TO`** so magic links open **user web** at **`{origin}/auth/callback?next=/caretaker/join`** instead of `abstrack://…`. Use an absolute **`http://` or `https://`** origin (trailing slash trimmed). Allow-list **`https://<your-user-web-host>/auth/callback`** (and **`http://localhost:3000/auth/callback`** locally if needed).

### Order of operations (cloud)

1. Apply the migration that creates **`public.caretaker_invites`** (same as any other migration): **`pnpm dlx supabase db push`** when you are ready (see [Recommended workflow](#recommended-workflow-one-pr-manual-db-push--gen-types-ci-as-backstop) above), then regenerate types if you use them for that table.
2. Configure caretaker invite secrets and Auth redirect URLs as in **[Caretaker invite: Supabase checklist (mobile-primary)](#caretaker-invite-supabase-checklist-mobile-primary)** above.
3. **Deploy the function** from the repo root (after login + link if using CLI):

   ```bash
   pnpm dlx supabase functions deploy patient-caretaker-access
   ```

### Auth redirect URLs (Dashboard → Authentication → URL Configuration)

- **Mobile (this repo’s default):** `abstrack:///caretaker-invite` (optional `abstrack://**` wildcard; see [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)).
- **Web (only if you use `ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN` instead of `REDIRECT_TO`):** `http://localhost:3000/auth/callback`, production `https://…/auth/callback`; invites append `?next=/caretaker/join`. Wildcard `http://localhost:3000/**` if the dashboard rejects query-only differences.

<a id="caretaker-invite-deploy-checklist"></a>

### Caretaker invite: production / staging (what to change when you deploy)

Use this when user web and/or mobile move off **localhost** to a **hosted** user-web origin (e.g. `https://app.example.com`). Secrets live in **Supabase Dashboard → Edge Functions → Secrets** (project-wide). **Do not** put `ABSTRACK_CARETAKER_INVITE_*` in `apps/web/.env.local`—Next.js does not read them; only the Edge function does.

Pick **one** invite redirect strategy per Supabase project (or use the same values in staging and production on **separate** projects).

#### A — Mobile-primary (default): magic link opens the native app

1. **Edge secret** `ABSTRACK_CARETAKER_INVITE_REDIRECT_TO` = **`abstrack:///caretaker-invite`** (exact string; three slashes after `abstrack:`).
2. **Edge secret** `ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN`: **omit** (delete/unset) so invites do not fall back to web `auth/callback` unless you intentionally support both.
3. **Auth → Redirect URLs:** allow **`abstrack:///caretaker-invite`** (or **`abstrack://**`\*\* if the dashboard requires a wildcard).
4. **`apps/mobile/.env` (or EAS secrets for release builds):** set **`EXPO_PUBLIC_USER_WEB_ORIGIN`** to the **same HTTPS origin** as production user web (e.g. `https://app.example.com`) so Universal Links / App Links in `app.config.ts` match invite completion URLs. **Rebuild** native (`pnpm ios` / `pnpm android` from `apps/mobile/`, or your CI/EAS build) after changing this—`associatedDomains` / `intentFilters` are build-time.
5. **User web hosting (`apps/web`):** set **`APPLE_APP_SITE_ASSOCIATION_TEAM_ID`** (and optionally **`APPLE_IOS_BUNDLE_ID`**) plus **`ANDROID_APP_LINKS_SHA256_CERT_FINGERPRINTS`** (and optionally **`ANDROID_APPLICATION_ID`**) on the **deployed** Next server so **`/.well-known/*`** is served over **HTTPS** without redirects (Apple/Google requirements). See [HTTPS invite → same link opens browser (desktop) and native app (phone)](#https-invite--same-link-opens-browser-desktop-and-native-app-phone) above.
6. **Deploy** `patient-caretaker-access` after any Edge secret change: `pnpm dlx supabase functions deploy patient-caretaker-access` (repo root, linked project).

#### B — Web invite path: magic link opens user web (`/auth/callback` then `/caretaker/join`)

1. **Edge secret** `ABSTRACK_CARETAKER_INVITE_REDIRECT_TO`: **omit** (delete/unset).
2. **Edge secret** `ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN` = your **public user-web origin only** (no path), e.g. **`https://app.example.com`** (scheme + host; trailing slash optional, it is trimmed). For local laptop-only testing, **`http://localhost:3000`** is valid; hosted deploys should use **`https://…`**.
3. **Auth → Redirect URLs:** add **`https://app.example.com/auth/callback`** (replace host with yours). If the UI rejects query strings, add **`https://app.example.com/**`\*\* as documented above.
4. **`apps/mobile/.env`:** set **`EXPO_PUBLIC_USER_WEB_ORIGIN`** to the **same origin** as **`ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN`** so phones opening the same `https://…/auth/callback?…` link can hand off to the app where configured. Rebuild native after changes.
5. **Deploy** `patient-caretaker-access` after secret changes (same command as A).

#### C — “Both” mobile scheme and web callback in one project

`inviteUserByEmail` accepts **one** `redirectTo` per invite. This repo’s Edge function sets it from **`ABSTRACK_CARETAKER_INVITE_REDIRECT_TO`** when that secret is non-empty; **otherwise** it uses **`ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN` + `/auth/callback?next=/caretaker/join`**. There is **no** branch that writes two URLs into one email.

- If **`REDIRECT_TO`** = **`abstrack:///caretaker-invite`**: that invite finishes in the **native app** when the caretaker’s client understands the **`abstrack:`** URL. A **desktop browser** will not complete the same link as normal user web.
- If **`REDIRECT_TO`** is **unset** and **`WEB_ORIGIN`** is a **normal `https://` user-web origin** (including a **dev tunnel** below): the same magic link can load **user web** in a browser. On a phone, the **installed app** may still open the same **`https://…/auth/callback?…`** URL when **App Links / Universal Links** (and your `EXPO_PUBLIC_USER_WEB_ORIGIN`) line up—otherwise the caretaker completes in the **browser** only.

To exercise **web and phone** from **one** invite **without deploying** user web, use **D** (tunnel). To prioritize **Gmail → app** on a device with **no** tunnel, use **A** and accept that **that** invite is not the way you test desktop web completion.

#### D — Local, not deployed: one invite for user web (browser) and phone

Use this when user web runs on your machine (e.g. port **3000**) but Supabase Auth must see an **`https://`** (or at least **reachable**) **`redirectTo`**, and you want **laptop browsers** and **phones** to hit **the same** callback URL.

1. **Run user web** locally on **3000** (see [DEV_SETUP.md](DEV_SETUP.md) for the usual `apps/web` dev command).
2. **Expose 3000 with HTTPS**, e.g. [ngrok](https://ngrok.com/) `ngrok http 3000` or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) `cloudflared tunnel --url http://localhost:3000`. Copy the public **`https://…`** origin with **no** path (example: `https://abcd-1-2-3.ngrok-free.app`).
3. **Supabase → Edge Functions → Secrets** (linked project):
   - **Remove** **`ABSTRACK_CARETAKER_INVITE_REDIRECT_TO`** (or leave it empty) so invites use the web callback.
   - Set **`ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN`** to that origin only, e.g. `https://abcd-1-2-3.ngrok-free.app` (no trailing slash).
4. **Supabase → Authentication → URL Configuration → Redirect URLs:** add **`https://<your-tunnel-host>/auth/callback`**. If the dashboard rejects query-only variants, add **`https://<your-tunnel-host>/**`\*\* as documented in [Auth redirect URLs](#auth-redirect-urls-dashboard--authentication--url-configuration) above.
5. **Redeploy** the Edge function so it reads the new secrets: `pnpm dlx supabase functions deploy patient-caretaker-access` (repo root; you run this—agents do not push secrets for you).
6. **`apps/mobile/.env`:** set **`EXPO_PUBLIC_USER_WEB_ORIGIN`** to the **same** `https://…` origin as step 2. **Rebuild** native (`pnpm android` / `pnpm ios` from `apps/mobile/`) so `app.config.ts` intent filters / associated domains match that host.
7. **`apps/web/.env.local`:** keep **`NEXT_PUBLIC_SUPABASE_URL`** and **`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`** pointed at this **same** Supabase project (unchanged from normal local web dev).
8. **Patient** sends a caretaker invite from **mobile Settings** or **user web Settings**.
9. **Caretaker on a laptop:** open the email link in Chrome/Firefox → the browser should load **`https://…/auth/callback?…&next=/caretaker/join`** via the tunnel → your local Next handles PKCE → **`/caretaker/join`**.
10. **Caretaker on a phone:** use the **same** email link. If the in-app mail browser misbehaves (cookies, interstitials), use **Open in Chrome** / **system browser** so the **`https://…`** URL reaches your tunnel reliably. **Verified** App Links to open the **Expo** app without deploy are limited; until **`/.well-known/assetlinks.json`** is live on that HTTPS host with your debug/release cert fingerprints, treat **browser completion** as the reliable path on device; the app still handles the same URL when the OS delivers it to ABStrack (see `apps/mobile/src/app/App.tsx`).

**`adb reverse tcp:3000 tcp:3000`:** only helps when the phone loads **`http://localhost:3000`** and the **process** respects the reverse mapping (e.g. some system browsers). **Gmail’s embedded browser** often **does not** make invite testing reliable with **`ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN=http://localhost:3000`**; prefer **D** for “email link on a real phone” plus **web** on a laptop.

#### Staging vs production

- Use **staging** URLs and secrets on a **staging** Supabase project (or the same project only if you accept shared Auth redirect noise).
- **`NEXT_PUBLIC_SUPABASE_URL`** / **`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`** in `apps/web/.env.local` and **`EXPO_PUBLIC_*`** in `apps/mobile/.env` must point at the **same** project whose Edge secrets you configured.

---

## Patient practitioner Edge Function (`patient-practitioner-access`)

Patients invite healthcare practitioners from **user web** (`apps/web` Settings) and **mobile** (`apps/mobile` Settings). For a **new email** (no Auth user yet), the function inserts a pending **`practitioner_invites`** row and sends **`auth.admin.inviteUserByEmail`** with **`data.abstrack_practitioner_invite_id`** (caretaker-style); it does **not** insert **`practitioner_access`** until the invitee **finalizes** with **POST** `{ finalizePractitionerInvite: true, inviteId }` using their **practitioner** session—that path ensures **`profiles.app_role = practitioner`** when needed, inserts or reactivates **`practitioner_access`** with **`revoked_at` null**, and **consumes** the invite row. **Link-existing** (email already maps to an Auth user whose **`profiles.app_role`** is **`practitioner`**) still creates the grant immediately. **Revoke** sets **`revoked_at`** (RLS denies future reads; already-viewed data is not erased—PRD §8). **Cancel pending** removes the pending invite row. **Invite and resend** throttles (**`429`** + **`Retry-After`**, 90s minimum): pending email flows use **`practitioner_invites.last_invite_sent_at`** and **`stamp_practitioner_invite_pre_send`** before Auth mail (like **`caretaker_invites`**); **active-grant** **`inviteUserByEmail`** resends use **`practitioner_access.last_invite_email_sent_at`** and **`stamp_practitioner_access_last_invite_email_sent_at`**.

**Practitioner MFA and PHI reads (fail-closed, password-gated):** This function only manages grants and invites; **patient data reads** are enforced by RLS (`user_has_practitioner_access`) and the practitioner app patient-route gate. **TOTP + JWT `aal = aal2` are required for PHI only when the practitioner has enabled password sign-in** — Auth **`user_metadata.abstrack_practitioner_password_set`** is set to **`true`** when they save a password on **`/update-password`** (optional on **`/invite/join`**). **Magic-link–only** invitees (flag absent/false) may read with **AAL1** once grant + **`profiles.app_role = practitioner`** are satisfied. **Password** sign-in (credential-stuffing risk) requires enrolled TOTP and an **AAL2** session before patient routes and RLS allow PHI; see migration **`20260517120000_practitioner_mfa_aal2_password_sign_in_only.sql`** and **`practitioner-mfa-auth-audit`** for password-path audit. This is **not** universal mandatory TOTP at first invite acceptance.

**Server-only secrets (hosted Edge):** `SUPABASE_URL` and **`SUPABASE_SECRET_KEYS`** with a valid **`default`** `sb_secret_…` entry (same model as `patient-caretaker-access` and `practitioner-mfa-auth-audit`). **Do not** use legacy **`SUPABASE_SERVICE_ROLE_KEY`** in new work.

**Invite `redirectTo` (Edge secrets, Supabase Dashboard → Edge Functions → Secrets):**

1. **`ABSTRACK_PRACTITIONER_INVITE_REDIRECT_TO`** — optional. When non-empty after trim, used **verbatim** as Auth **`redirectTo`** (must be listed under **Authentication → URL Configuration → Redirect URLs**). Example: `https://practitioner.example.com/auth/callback?next=/invite/join`. If you previously set `next=/`, update the secret to **`next=/invite/join`** (or clear the secret and use **`ABSTRACK_PRACTITIONER_INVITE_WEB_ORIGIN`** so the Edge function builds the URL). The practitioner Next app mirrors user web: **`src/proxy.ts`** (Next.js 16 proxy) rewrites implicit returns to **`/auth/callback/fragment`**, **`app/auth/callback/route.ts`** exchanges PKCE **`?code=`** on the server, and **`app/auth/callback/fragment/page.tsx`** completes **`#access_token=`** sessions in the browser.
2. **`ABSTRACK_PRACTITIONER_INVITE_WEB_ORIGIN`** — used **only** when **`ABSTRACK_PRACTITIONER_INVITE_REDIRECT_TO`** is unset/empty. Must be an absolute **`http://` or `https://`** origin (trailing slashes trimmed). The function builds **`{origin}/auth/callback?next=/invite/join`** (post-invite landing at **`/invite/join`**: finalize invite, then **Go to patient workspace** for magic-link sign-in, or optional **Create a password** → TOTP on **`/`** only if a password is saved).

**Database:** apply migrations **`20260514120000_practitioner_access_service_role_edge.sql`** (**`service_role`** INSERT/UPDATE on **`practitioner_access`**, **`list_practitioner_auth_emails_for_patient_grants`**), **`20260515180000_practitioner_invites.sql`** (**`practitioner_invites`**, **`stamp_practitioner_invite_pre_send`**), **`20260516200000_practitioner_access_last_invite_email_sent_at.sql`** (**`practitioner_access.last_invite_email_sent_at`**, **`stamp_practitioner_access_last_invite_email_sent_at`**), and **`20260517120000_practitioner_mfa_aal2_password_sign_in_only.sql`** (**`user_has_practitioner_access`**: AAL2 only when **`abstrack_practitioner_password_set`**) with your normal **`db push`** flow before relying on the function in cloud.

**Deploy** (repo root, linked project):

```bash
pnpm dlx supabase functions deploy patient-practitioner-access
```

**Supabase config:** `supabase/config.toml` sets **`verify_jwt = false`** for this function; the handler validates the Bearer session. **Patient** routes (list, invite, resend, revoke, cancel pending) require **`profiles.app_role = patient`**; **finalize** uses a **practitioner** session.

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

**CI:** add repository secret **`SUPABASE_SECRET_KEY`** with the **secret** API key string (`sb_secret_…`) from the Supabase UI under **Settings → API Keys** (server-only; never client bundles). [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) passes it **only** to the **Test @abstrack/supabase** step (`env: SUPABASE_SECRET_KEY: ${{ secrets.SUPABASE_SECRET_KEY }}`), not to the whole job, so other steps and actions do not see it. Integration tests run when the secret is present. Fork PRs do not receive secrets, so those jobs skip integration and still pass.

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
| `chart_snapshots` dev cleanup | **Dev cleanup: `chart_snapshots`** (above); migration `20260524140000_chart_snapshots.sql`         |
