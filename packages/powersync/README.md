# @abstrack/powersync

Shared **PowerSync client schema** and **sync rules** for ABStrack mobile offline replication against Supabase Postgres.

PowerSync connects with a replication role that bypasses RLS; **download scope is defined only by sync rules** (`sync-rules.yaml`), which intentionally mirror grant logic in `supabase/migrations/20260327130000_rls_policies.sql` and practitioner MFA (`aal2`) in `20260416120000_practitioner_mfa_assurance_rls.sql`.

## Contents

| Artifact                          | Purpose                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `sync-rules.yaml`                 | Deploy to your PowerSync Service — bucket definitions per patient / caretaker / practitioner.    |
| `abstrackPowerSyncSchema`         | Client SQLite schema (`@powersync/common` `Schema`) matching replicated `public` tables.         |
| `visiblePatientUserIdsForPhiSync` | Pure helper + Vitest smoke tests; keep in sync with PHI buckets in YAML when grant rules change. |

Path constant: `ABSTRACK_POWERSYNC_SYNC_RULES_PACKAGE_PATH` (`packages/powersync/sync-rules.yaml`).

## Mobile usage (SQLCipher)

The Expo app wires encryption and connectors in `apps/mobile/src/lib/powersync/`:

1. **`createEncryptedAbstrackPowerSyncDatabase`** — `@powersync/op-sqlite` `OPSqliteOpenFactory` + SQLCipher (`op-sqlite.sqlcipher` in `apps/mobile/package.json` and monorepo root `package.json`).
2. **`createSupabaseJwtPowerSyncConnector`** — `fetchCredentials` uses `EXPO_PUBLIC_POWERSYNC_URL` and the Supabase session access token; configure PowerSync to trust Supabase JWTs.

Typical sequence: `await db.init()`, then `await db.connect(connector)`, then `await db.waitForFirstSync()`.

**Writes:** Mutating PHI still goes through Supabase with RLS while online. Local CRUD on synced tables is not enabled yet; the connector fails closed if upload batches appear.

## Ops checklist

- Provision PowerSync against the same Postgres as Supabase.
- Upload **`packages/powersync/sync-rules.yaml`** to the PowerSync instance whenever bucket logic changes.
- Ensure deployed JWT validation exposes `sub`, `aal`, and any claims referenced in rules (Supabase includes `aal` when MFA is enforced).

## Build / test

```bash
pnpm exec nx build @abstrack/powersync
pnpm exec nx test @abstrack/powersync
```
