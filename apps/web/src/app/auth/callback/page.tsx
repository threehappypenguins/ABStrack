'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AUTH_CALLBACK_INVALID_LINK_MESSAGE,
  getSafeAuthCallbackRedirectPath,
} from '@/lib/auth/auth-callback-redirect';
import { createBrowserClient } from '@/lib/supabase/browser-client';

/**
 * Parses Supabase Auth implicit-flow parameters from the URL hash
 * (`#access_token=…&refresh_token=…`). The fragment is never sent to the server.
 *
 * @param hash - `window.location.hash` or equivalent (may include leading `#`).
 * @returns Key/value map of hash query parameters.
 */
function parseImplicitHashParams(hash: string): Record<string, string> {
  const trimmed = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(trimmed);
  const out: Record<string, string> = {};
  params.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function redirectWithError(
  router: ReturnType<typeof useRouter>,
  redirectPath: string,
  message: string,
) {
  const url = new URL(redirectPath, window.location.origin);
  url.searchParams.set('error', message);
  router.replace(`${url.pathname}${url.search}${url.hash}`);
}

/**
 * Finishes browser auth after the user opens an email link: PKCE (`?code=`) or
 * implicit tokens in the URL hash. Must be a client page so the hash is visible.
 *
 * @returns Auth callback UI (brief loading state).
 */
export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <main aria-live="polite" className="p-6">
          Finishing sign-in…
        </main>
      }
    >
      <AuthCallbackContent />
    </Suspense>
  );
}

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [surfaceError, setSurfaceError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setSurfaceError(null);

      const next = searchParams.get('next');
      const code = searchParams.get('code');
      const redirectPath = getSafeAuthCallbackRedirectPath(next);
      /** Capture before any `await`; `detectSessionInUrl` may clear the hash. */
      const implicitHashSnapshot =
        typeof window !== 'undefined' ? window.location.hash : '';

      const supabase = createBrowserClient();

      const finishOk = () => {
        if (cancelled) return;
        if (typeof window !== 'undefined') {
          const u = new URL(window.location.href);
          u.searchParams.delete('code');
          u.hash = '';
          window.history.replaceState(null, '', `${u.pathname}${u.search}`);
        }
        router.replace(redirectPath);
      };

      const finishErr = (message: string) => {
        if (cancelled) return;
        redirectWithError(router, redirectPath, message);
      };

      try {
        const {
          data: { session: existing },
        } = await supabase.auth.getSession();

        if (existing?.user) {
          finishOk();
          return;
        }

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (cancelled) return;
          if (error) {
            finishErr(AUTH_CALLBACK_INVALID_LINK_MESSAGE);
            return;
          }
          finishOk();
          return;
        }

        if (implicitHashSnapshot) {
          const hp = parseImplicitHashParams(implicitHashSnapshot);
          const access_token = hp.access_token;
          const refresh_token = hp.refresh_token;
          const hashError = hp.error;

          if (hashError) {
            const desc = hp.error_description ?? hashError;
            let message = desc;
            try {
              message = decodeURIComponent(desc.replace(/\+/g, ' '));
            } catch {
              message = desc;
            }
            finishErr(message);
            return;
          }

          if (access_token && refresh_token) {
            const { error } = await supabase.auth.setSession({
              access_token,
              refresh_token,
            });
            if (cancelled) return;
            if (error) {
              finishErr(AUTH_CALLBACK_INVALID_LINK_MESSAGE);
              return;
            }
            finishOk();
            return;
          }
        }

        const {
          data: { session: afterDetect },
        } = await supabase.auth.getSession();

        if (afterDetect?.user) {
          finishOk();
          return;
        }

        finishErr(AUTH_CALLBACK_INVALID_LINK_MESSAGE);
      } catch {
        if (!cancelled) {
          setSurfaceError(AUTH_CALLBACK_INVALID_LINK_MESSAGE);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  if (surfaceError) {
    return (
      <main role="alert" className="p-6">
        {surfaceError}
      </main>
    );
  }

  return (
    <main aria-live="polite" className="p-6">
      Finishing sign-in…
    </main>
  );
}
