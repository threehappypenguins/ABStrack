import { useEffect, useState } from 'react';

import { getMobileSupabaseClient } from '../supabase-wiring';

/**
 * Subscribes to Supabase auth and exposes the signed-in user id from the persisted session.
 *
 * Uses `auth.getSession()` (not `getUser()`) so Manage and other tabs still resolve the user id
 * offline; `getUser()` validates with the server and often fails with “Network request failed”.
 *
 * @returns Current user id, or `null` when signed out / unresolved.
 */
export function useMobileAuthUserId(): string | null {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const client = getMobileSupabaseClient();

    const refresh = () => {
      const auth = client.auth;
      if (typeof auth.getSession === 'function') {
        void auth
          .getSession()
          .then(({ data }) => {
            setUserId(data.session?.user?.id ?? null);
          })
          .catch(() => {
            setUserId(null);
          });
        return;
      }
      if (typeof auth.getUser === 'function') {
        void auth
          .getUser()
          .then(({ data }) => {
            setUserId(data.user?.id ?? null);
          })
          .catch(() => {
            setUserId(null);
          });
      }
    };

    refresh();

    if (typeof client.auth.onAuthStateChange !== 'function') {
      return;
    }

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange(() => {
      refresh();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return userId;
}
