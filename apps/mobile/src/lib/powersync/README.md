# Mobile PowerSync wiring (`apps/mobile/src/lib/powersync`)

## Lifecycle

[`PowerSyncSessionBridge.tsx`](./PowerSyncSessionBridge.tsx) runs inside [`App.tsx`](../../app/App.tsx) for the whole app (auth + main):

1. When `EXPO_PUBLIC_POWERSYNC_URL` is set **and** the user has a Supabase `access_token`, the bridge resolves a SQLCipher key, opens the shared encrypted DB (`createEncryptedAbstrackPowerSyncDatabase`), calls `init()` → `connect(createSupabaseJwtPowerSyncConnector(...))` → `waitForFirstSync()`.
2. When the session loses `access_token` (sign-out), the bridge calls `disconnectAndClear()` so **no sync connection stays open with stale JWTs** and replicated PHI in SQLite is wiped. `fetchCredentials` already returns `null` when signed out; disconnect is defense in depth.
3. If `EXPO_PUBLIC_POWERSYNC_URL` is empty, the DB is not opened and all reads remain Supabase/network-only.

## SQLCipher key

[`powersync-sqlcipher-key.ts`](./powersync-sqlcipher-key.ts) generates a random key once per install and stores it in **expo-secure-store** (device-bound). It is **not** the Supabase JWT and not user-scoped; logout clears replicated rows, not the file key. Per-user or hardware-backed keys can replace this helper later without changing sync rules.

## Read paths (this issue)

| Surface                         | PowerSync-backed behavior                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| **Home** — continue episode CTA | Falls back to SQLite after the Supabase active-episode **request throws** (e.g. offline). |
| **Manage → Episodes**           | Falls back to SQLite for active + completed lists when Supabase list calls **error**.     |

SQL lives in [`episode-powersync-read.ts`](./episode-powersync-read.ts). Offline completed history is capped at `POWERSYNC_OFFLINE_EPISODE_PAGE_SIZE` and **does not apply** Manage date filters yet (documented limitation).

## Still network-only (examples)

- Episode **mutations** (cancel, delete, resume flows that write), media **signed URLs**, presets/templates CRUD, health checks, anything not yet querying SQLite.

## Next issue (#138)

Assumes sync + read path above is live. Offline **blob** capture, staging, Storage upload worker, and media encryption are out of scope here.
