import type { AbstrackSupabaseClient, Session } from '@abstrack/supabase';

import {
  getMobileSupabaseClient,
  mobileAuthStorage,
} from './supabase-wiring-core';

type MobileAuthGetSessionResult = Awaited<
  ReturnType<AbstrackSupabaseClient['auth']['getSession']>
>;

/**
 * Mobile `auth.getSession()` wrapper: GoTrue may **reject** (e.g. Hermes
 * `TypeError: Network request failed`) when the access JWT is inside the library’s expiry margin
 * and a refresh attempt fails offline — it does not always return `{ data, error }`.
 *
 * On rejection, reads the persisted session JSON from {@link mobileAuthStorage} using the
 * client’s internal `storageKey`, so offline flows (Home, Manage, PowerSync JWT) still see the
 * last saved session instead of surfacing an unhandled rejection.
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
      return { data: { session }, error: null };
    } catch {
      return { data: { session: null }, error: null };
    }
  }
}
