# @abstrack/powersync

Shared **PowerSync Sync Streams** config (YAML, edition 3), **sync-scope helpers**, and tests for ABStrack mobile offline replication against Supabase Postgres.

The **client SQLite schema** (`abstrackPowerSyncSchema`) lives in **`apps/mobile/src/lib/powersync/abstrack-app-schema.ts`** so `Schema` / `Table` use the same `@powersync/react-native` entrypoint as `PowerSyncDatabase` (no unsafe casts).

PowerSync connects with a replication role that bypasses RLS; **download scope is defined only by Sync Streams** (`sync-rules.yaml`), which mirror grant logic in `supabase/migrations/20260327130000_rls_policies.sql` and practitioner MFA (`aal2`) in `20260416120000_practitioner_mfa_assurance_rls.sql`.

## Contents

| Artifact                          | Purpose                                                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sync-rules.yaml`                 | Deploy via PowerSync Dashboard **Sync Streams** (`config.edition: 3`, `streams`, global `with` CTEs). See [Sync Streams overview](https://docs.powersync.com/sync/streams/overview). |
| `REPLICATED_PUBLIC_TABLE_NAMES`   | Canonical replicated `public` table list; Vitest checks YAML, migration SQL, and mobile `Schema` keys stay aligned.                                                                  |
| Mobile `abstrack-app-schema.ts`   | Client SQLite schema (`Schema` from `@powersync/react-native`); must stay aligned with this YAML.                                                                                    |
| `visiblePatientUserIdsForPhiSync` | Pure helper + Vitest smoke tests; keep in sync with PHI buckets in YAML when grant rules change.                                                                                     |

Path constant: `ABSTRACK_POWERSYNC_SYNC_RULES_PACKAGE_PATH` (`packages/powersync/sync-rules.yaml`).

## Mobile usage (SQLCipher)

The Expo app wires schema, encryption, and connectors in `apps/mobile/src/lib/powersync/`:

1. **`abstrackPowerSyncSchema`** — table definitions next to the SDK (see `abstrack-app-schema.ts`).
2. **`createEncryptedAbstrackPowerSyncDatabase`** — `@powersync/op-sqlite` `OPSqliteOpenFactory` + SQLCipher (`op-sqlite.sqlcipher` in `apps/mobile/package.json` and monorepo root `package.json`).
3. **`createSupabaseJwtPowerSyncConnector`** — pass `powerSyncUrl` (e.g. `EXPO_PUBLIC_POWERSYNC_URL` from env); `fetchCredentials` uses that endpoint and the Supabase session access token; configure PowerSync to trust Supabase JWTs.

Typical sequence: `await db.init()`, then `await db.connect(connector)`, then `await db.waitForFirstSync()`.

**Mobile app (Expo):** `PowerSyncSessionBridge` in `apps/mobile/src/app/App.tsx` runs this sequence when `EXPO_PUBLIC_POWERSYNC_URL` is set and the user is signed in. After first sync, **Home** (active episode CTA) and **Manage → Episodes** can read replicated `episodes` from SQLite when Supabase requests fail (offline). See `apps/mobile/src/lib/powersync/README.md` for lifecycle, SQLCipher key notes, and what remains network-only.

**Writes:** Mutating PHI still hits Supabase with RLS for paths that are not wired through PowerSync. On mobile, `createSupabaseJwtPowerSyncConnector` **does** upload queued local CRUD on replicated tables to PostgREST (same user JWT / RLS) after sync — coverage is **partial** (episode flows where the offline-first gateway is used; many preset/template and other flows remain network-only). See **`apps/mobile/src/lib/powersync/README.md`** (“Writes (partial)”) and `apps/mobile/src/lib/powersync/supabase-jwt-connector.ts`.

## Validate or deploy sync rules (CLI)

**Default path:** GitHub Actions runs **`pull instance`** (loads real **`service.yaml`** from Cloud), overlays **`packages/powersync/sync-rules.yaml`** as **`sync-config.yaml`**, then **`validate`** on PRs / branch pushes and **`deploy sync-config`** on **`main`** ([**`powersync-sync-config.yml`**](../../.github/workflows/powersync-sync-config.yml)). Use the steps below only if you need the CLI locally.

The CLI resolves **`--directory` relative to the current working directory** (`path.join(process.cwd(), directory)`). Use a temp dir, **`cd` into it**, and pass **`--directory=.`** so **`pull instance`** / **`validate`** / **`deploy`** write and read **`service.yaml`** in that folder (same as CI).

After **`pnpm dlx powersync@0.9.4 login`** (or **`export PS_ADMIN_TOKEN='…'`**), from the monorepo root:

```bash
export INSTANCE_ID='your-instance-id'
export PROJECT_ID='your-project-id'
# Optional: export ORG_ID='…' if your token spans multiple orgs

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

**Deploy** sync config only (stay in **`$CONFIG_DIR`** after a successful validate):

```bash
deploy_args=(deploy sync-config --directory=. --instance-id="$INSTANCE_ID" --project-id="$PROJECT_ID")
[ -n "${ORG_ID:-}" ] && deploy_args+=(--org-id="$ORG_ID")
pnpm dlx powersync@0.9.4 "${deploy_args[@]}"
```

Background, login vs **`PS_ADMIN_TOKEN`**, and GitHub secret names: **[docs/SUPABASE_CLOUD_DEVELOPER.md — PowerSync Sync Streams](../../docs/SUPABASE_CLOUD_DEVELOPER.md#powersync-sync-streams-packagespowersyncsync-rulesyaml)**.

## Ops checklist

- Provision PowerSync against the same Postgres as Supabase.
- Keep **`POWERSYNC_*`** GitHub secrets configured so **`.github/workflows/powersync-sync-config.yml`** can validate every branch and deploy **`sync-rules.yaml`** on **`main`** merges.
- Optional: manual CLI block above if you need to validate or deploy outside CI.
- Ensure deployed JWT validation exposes `sub`, `aal`, and any claims referenced in rules (Supabase includes `aal` when MFA is enforced).

## Build / test

```bash
pnpm exec nx build @abstrack/powersync
pnpm exec nx test @abstrack/powersync
```
