import { useEffect, useRef, useState } from 'react';

import {
  getMobileAuthSessionSafe,
  getMobileSupabaseClient,
  isAuthSessionRecoveryFailure,
} from '../supabase-wiring';

type MobileAuthGetSessionResult = Awaited<
  ReturnType<typeof getMobileAuthSessionSafe>
>;

/**
 * Subscribes to Supabase auth and exposes the signed-in user id from the persisted session.
 *
 * Uses {@link getMobileAuthSessionSafe} (not `getUser()`) so Manage and other tabs still resolve the user id
 * offline; `getUser()` validates with the server and often fails with “Network request failed”.
 *
 * Transient {@link getMobileAuthSessionSafe} recovery failures (`auth_session_recovery_failed`) do **not**
 * clear the hook state when a prior user id exists or `auth.onAuthStateChange` just supplied one — only
 * `SIGNED_OUT` or a resolved empty session **without** that recovery error clears it (Home/Manage avoid a
 * signed-out flash on storage hiccups).
 *
 * Overlapping refresh calls (e.g. rapid `onAuthStateChange` events) are sequenced so an older
 * `getSession` / `getUser` result cannot overwrite a newer sign-out or account switch.
 *
 * @returns Current user id, or `null` when signed out / unresolved.
 */
export function useMobileAuthUserId(): string | null {
  const [userId, setUserId] = useState<string | null>(null);
  const lastKnownUserIdRef = useRef<string | null>(null);

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

    const resolveFromSafeResult = (
      generation: number,
      result: MobileAuthGetSessionResult,
    ) => {
      const { data, error } = result;
      const id =
        data.session?.user?.id != null && data.session.user.id !== ''
          ? data.session.user.id
          : null;
      if (id != null) {
        lastKnownUserIdRef.current = id;
        applyIfCurrent(generation, id);
        return;
      }
      if (error != null && isAuthSessionRecoveryFailure(error)) {
        applyIfCurrent(generation, lastKnownUserIdRef.current);
        return;
      }
      lastKnownUserIdRef.current = null;
      applyIfCurrent(generation, null);
    };

    const refresh = () => {
      const auth = client.auth;
      const generation = ++refreshGeneration;
      if (typeof auth.getSession === 'function') {
        void getMobileAuthSessionSafe()
          .then((result) => {
            resolveFromSafeResult(generation, result);
          })
          .catch(() => {
            applyIfCurrent(generation, lastKnownUserIdRef.current);
          });
        return;
      }
      if (typeof auth.getUser === 'function') {
        void auth
          .getUser()
          .then(({ data }) => {
            const id =
              data.user?.id != null && data.user.id !== ''
                ? data.user.id
                : null;
            if (id != null) {
              lastKnownUserIdRef.current = id;
            } else {
              lastKnownUserIdRef.current = null;
            }
            applyIfCurrent(generation, id);
          })
          .catch(() => {
            applyIfCurrent(generation, lastKnownUserIdRef.current);
          });
      }
    };

    if (typeof client.auth.onAuthStateChange !== 'function') {
      refresh();
      return () => {
        cancelled = true;
      };
    }

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, _session) => {
      if (event === 'SIGNED_OUT') {
        const generation = ++refreshGeneration;
        lastKnownUserIdRef.current = null;
        applyIfCurrent(generation, null);
        return;
      }
      refresh();
    });

    refresh();

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return userId;
}
