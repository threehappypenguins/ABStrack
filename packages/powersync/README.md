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

**Writes:** Mutating PHI still goes through Supabase with RLS while online. Local CRUD on synced tables is not enabled yet; the connector fails closed if upload batches appear.

## Validate or deploy sync rules (CLI)

**Default path:** GitHub Actions validates on every PR and branch push when **`sync-rules.yaml`** changes, and deploys to PowerSync Cloud only when **`main`** is pushed after a successful validate ([**`powersync-sync-config.yml`**](../../.github/workflows/powersync-sync-config.yml)). Use the steps below only if you need to run the CLI locally.

**Run every command from the monorepo root** (the folder that contains `packages/`). **`pnpm dlx powersync@0.9.4 validate` by itself always fails** with `Directory "powersync" not found`: the CLI needs a directory created by **`init cloud`**, then your rules copied to **`sync-config.yaml`** inside it (same pattern as that workflow).

After **`pnpm dlx powersync@0.9.4 login`** (or **`export PS_ADMIN_TOKEN='…'`**), set **`INSTANCE_ID`** and **`PROJECT_ID`** from the PowerSync dashboard, then:

```bash
# From repo root only
POWERSYNC_DIR=$(mktemp -d)
pnpm dlx powersync@0.9.4 init cloud --directory="$POWERSYNC_DIR"
cp packages/powersync/sync-rules.yaml "$POWERSYNC_DIR/sync-config.yaml"
export INSTANCE_ID='your-instance-id'
export PROJECT_ID='your-project-id'
# Optional: export ORG_ID='…' if your token spans multiple orgs

validate_args=(validate --directory="$POWERSYNC_DIR" --instance-id="$INSTANCE_ID" --project-id="$PROJECT_ID")
[ -n "${ORG_ID:-}" ] && validate_args+=(--org-id="$ORG_ID")
pnpm dlx powersync@0.9.4 "${validate_args[@]}"
```

**Deploy** sync config only (reuse **`$POWERSYNC_DIR`** in the **same shell** right after a successful validate):

```bash
deploy_args=(deploy sync-config --directory="$POWERSYNC_DIR" --instance-id="$INSTANCE_ID" --project-id="$PROJECT_ID")
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
