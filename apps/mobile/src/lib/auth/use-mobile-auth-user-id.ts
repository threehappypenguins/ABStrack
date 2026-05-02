import { useEffect, useState } from 'react';

import { getMobileSupabaseClient } from '../supabase-wiring';

/**
 * Subscribes to Supabase auth and exposes `auth.users.id` for the signed-in user.
 *
 * Prefers `auth.getUser()` when present;
 * falls back to `auth.getSession()` so lightweight Jest mocks stay valid.
 *
 * @returns Current user id, or `null` when signed out / unresolved.
 */
export function useMobileAuthUserId(): string | null {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const client = getMobileSupabaseClient();

    const refresh = () => {
      const auth = client.auth;
      if (typeof auth.getUser === 'function') {
        void auth
          .getUser()
          .then(({ data }) => {
            setUserId(data.user?.id ?? null);
          })
          .catch(() => {
            setUserId(null);
          });
        return;
      }
      if (typeof auth.getSession === 'function') {
        void auth
          .getSession()
          .then(({ data }) => {
            setUserId(data.session?.user?.id ?? null);
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
