import type { AbstrackSupabaseClient, Session } from '@abstrack/supabase';

import { decodeJwtPayloadUnsafeForDiagnostics } from './powersync/powersync-sync-diagnostics';
import {
  getMobileSupabaseClient,
  mobileAuthStorage,
} from './supabase-wiring-core';

type MobileAuthGetSessionResult = Awaited<
  ReturnType<AbstrackSupabaseClient['auth']['getSession']>
>;

/**
 * Whether a persisted Supabase session’s access token should be treated as expired **now**
 * (so callers must not use it as a live JWT — e.g. PowerSync after an offline refresh failure).
 *
 * Uses JWT `exp` when decodable, otherwise {@link Session.expires_at} when numeric. If neither
 * yields a finite expiry, returns `false` (best-effort offline behavior).
 *
 * @param session - Parsed session object from storage (not validated for shape beyond expiry).
 * @returns `true` when expiry is known and already in the past.
 */
export function isPersistedSupabaseSessionAccessExpired(
  session: Session,
): boolean {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = decodeJwtPayloadUnsafeForDiagnostics(session.access_token);
  const jwtExp =
    payload && typeof payload.exp === 'number' && Number.isFinite(payload.exp)
      ? payload.exp
      : null;
  if (jwtExp !== null && jwtExp <= nowSec) {
    return true;
  }
  const expiresAt =
    typeof session.expires_at === 'number' &&
    Number.isFinite(session.expires_at)
      ? session.expires_at
      : null;
  return expiresAt !== null && expiresAt <= nowSec;
}

/**
 * Mobile `auth.getSession()` wrapper: GoTrue may **reject** (e.g. Hermes
 * `TypeError: Network request failed`) when the access JWT is inside the library’s expiry margin
 * and a refresh attempt fails offline — it does not always return `{ data, error }`.
 *
 * On rejection, reads the persisted session JSON from {@link mobileAuthStorage} using the
 * client’s internal `storageKey`, so offline flows (Home, Manage, PowerSync JWT) still see the
 * last saved session instead of surfacing an unhandled rejection. Sessions whose access token is
 * already past JWT `exp` or past numeric {@link Session.expires_at} are **not** returned — callers
 * would otherwise keep using an expired JWT until a separate refresh succeeds.
 *
 * Resolves the Supabase client via {@link getMobileSupabaseClient} from `./supabase-wiring-core`
 * (not the `supabase-wiring` barrel) so Jest tests can `jest.mock('../../lib/supabase-wiring-core',
 * () => ({ ...requireActual(), getMobileSupabaseClient: jest.fn() }))` and this helper uses the
 * same mocked client as screens that import from the barrel.
 *
 * @returns Same shape as `SupabaseClient.auth.getSession()`.
 */
export async function getMobileAuthSessionSafe(): Promise<MobileAuthGetSessionResult> {
  const client = getMobileSupabaseClient();
  try {
    return await client.auth.getSession();
  } catch {
    const storageKey = (client.auth as unknown as { storageKey?: string })
      .storageKey;
    if (!storageKey) {
      return { data: { session: null }, error: null };
    }
    try {
      const raw = await mobileAuthStorage.getItem(storageKey);
      if (!raw) {
        return { data: { session: null }, error: null };
      }
      const session = JSON.parse(raw) as Session;
      if (
        !session ||
        typeof session !== 'object' ||
        typeof session.access_token !== 'string' ||
        session.access_token.length === 0
      ) {
        return { data: { session: null }, error: null };
      }
      if (isPersistedSupabaseSessionAccessExpired(session)) {
        return { data: { session: null }, error: null };
      }
      return { data: { session }, error: null };
    } catch {
      return { data: { session: null }, error: null };
    }
  }
}
