# Mobile PowerSync wiring (`apps/mobile/src/lib/powersync`)

## Lifecycle

[`PowerSyncSessionBridge.tsx`](./PowerSyncSessionBridge.tsx) runs inside [`App.tsx`](../../app/App.tsx) for the whole app (auth + main):

1. When `EXPO_PUBLIC_POWERSYNC_URL` is set **and** the Supabase session has **identity** (`session.user`, e.g. `user.id`), the bridge resolves a SQLCipher key, assigns the shared encrypted DB handle, and runs `init()`. **`connect()` → `waitForFirstSync()`** run only when **`access_token` is non-empty**; otherwise the local replica stays open for **offline reads** while the JWT connector’s `fetchCredentials` returns `null` (no bearer on the wire until refresh). An **expired / offline-persisted** session may legitimately have `access_token: ''` with `user` still present — that is **not** sign-out and does **not** trigger replica teardown.
2. **Sign-out** is when **identity disappears** (`session.user` gone). Then the bridge runs `disconnectAndClear()` so replicated PHI in SQLite is wiped. Do **not** treat empty `access_token` alone as sign-out for security or cleanup verification.
3. If `EXPO_PUBLIC_POWERSYNC_URL` is empty, the encrypted replica is **not** opened — **offline episode continuity on Home is unavailable**. Supabase remains required for auth and for practitioner/web parity; patient mobile should **always set** this URL for offline-first PHI. **Home** still performs a **narrow online-only** `getActiveEpisodeForUser` fallback when the URL is unset so dev installs without PowerSync are usable.

## SQLCipher key

[`powersync-sqlcipher-key.ts`](./powersync-sqlcipher-key.ts) generates a random key once per install and stores it in **expo-secure-store** (device-bound). It is **not** the Supabase JWT and not user-scoped; logout clears replicated rows, not the file key. Per-user or hardware-backed keys can replace this helper later without changing sync rules.

## Read paths (this issue)

| Surface                         | PowerSync-backed behavior                                                                                                                                                                                                                                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Home** — continue episode CTA | Primary: [`PowerSyncActiveEpisodeSubscription`](./PowerSyncActiveEpisodeSubscription.tsx) + replicated `episodes` when replica reads are enabled (**PowerSync is required for offline**). If `EXPO_PUBLIC_POWERSYNC_URL` is **unset**, Home falls back to **online** `getActiveEpisodeForUser` only (not offline-capable). |
| **Manage → Episodes**           | Falls back to SQLite for active + completed lists when Supabase list calls **error** (replica subscriptions + mirror state).                                                                                                                                                                                               |

SQL lives in [`episode-powersync-read.ts`](./episode-powersync-read.ts). Offline completed history uses a bound **`LIMIT ?`** (default `POWERSYNC_OFFLINE_EPISODE_PAGE_SIZE`; Manage grows it when paging without the network list) and respects the same inclusive **`ended_at`** bounds as the network list when Manage passes `endedAtOrAfter` / `endedAtOrBefore` (see [`PowerSyncEpisodeReadSubscriptions`](./PowerSyncEpisodeReadSubscriptions.tsx)).

## Writes (partial, this issue)

Queued local CRUD on replicated tables uploads via [`supabase-jwt-connector.ts`](./supabase-jwt-connector.ts) → [`powersync-supabase-upload.ts`](./powersync-supabase-upload.ts). Episode-flow screens use [`mobile-offline-first-gateway.ts`](../../episodes/mobile-offline-first-gateway.ts) where wired so mutations can hit SQLite + sync when PowerSync is available (not a full audit of every write path).

## Still network-only (examples)

- Media **signed URLs**, many preset/template CRUD paths, **dev** health check follow-up queries, and anything not yet listed above.

## Next issue (#138)

Assumes sync + read path above is live. Offline **blob** capture, staging, Storage upload worker, and media encryption are out of scope here.
