import { useEffect, useState } from 'react';

import {
  getMobileAuthSessionSafe,
  getMobileSupabaseClient,
} from '../supabase-wiring';

/**
 * Subscribes to Supabase auth and exposes the signed-in user id from the persisted session.
 *
 * Uses {@link getMobileAuthSessionSafe} (not `getUser()`) so Manage and other tabs still resolve the user id
 * offline; `getUser()` validates with the server and often fails with “Network request failed”.
 *
 * Overlapping refresh calls (e.g. rapid `onAuthStateChange` events) are sequenced so an older
 * `getSession` / `getUser` result cannot overwrite a newer sign-out or account switch.
 *
 * @returns Current user id, or `null` when signed out / unresolved.
 */
export function useMobileAuthUserId(): string | null {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const client = getMobileSupabaseClient();
    let cancelled = false;
    let refreshGeneration = 0;

    const applyIfCurrent = (generation: number, nextUserId: string | null) => {
      if (cancelled || generation !== refreshGeneration) {
        return;
      }
      setUserId(nextUserId);
    };

    const refresh = () => {
      const auth = client.auth;
      const generation = ++refreshGeneration;
      if (typeof auth.getSession === 'function') {
        void getMobileAuthSessionSafe()
          .then(({ data }) => {
            applyIfCurrent(generation, data.session?.user?.id ?? null);
          })
          .catch(() => {
            applyIfCurrent(generation, null);
          });
        return;
      }
      if (typeof auth.getUser === 'function') {
        void auth
          .getUser()
          .then(({ data }) => {
            applyIfCurrent(generation, data.user?.id ?? null);
          })
          .catch(() => {
            applyIfCurrent(generation, null);
          });
      }
    };

    refresh();

    if (typeof client.auth.onAuthStateChange !== 'function') {
      return () => {
        cancelled = true;
      };
    }

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange(() => {
      refresh();
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return userId;
}
