'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AUTH_CALLBACK_INVALID_LINK_MESSAGE,
  AUTH_CALLBACK_VERIFICATION_FAILED_MESSAGE,
  getSafeAuthCallbackRedirectPath,
} from '@/lib/auth/auth-callback-redirect';
import {
  isAuthSessionMissingError,
  isSupabaseAuthApiError,
} from '@abstrack/supabase';
import {
  isSupabaseBrowserConfigError,
  parseImplicitHashParams,
} from '@/lib/auth/auth-callback-fragment-helpers';
import { createBrowserClient } from '@/lib/supabase/browser-client';

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
 * Completes Supabase **implicit** auth (tokens in `#access_token=…`) after `/auth/callback` is
 * rewritten here from `src/proxy.ts` (middleware). PKCE (`?code=`) is handled in the parent
 * `route.ts` on the server so session cookies are set without exchanging the code in client JS.
 *
 * @returns Fragment callback UI (brief loading state).
 */
export default function AuthCallbackFragmentPage() {
  return (
    <Suspense
      fallback={
        <main aria-live="polite" className="p-6">
          Finishing sign-in…
        </main>
      }
    >
      <AuthCallbackFragmentContent />
    </Suspense>
  );
}

function AuthCallbackFragmentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [surfaceError, setSurfaceError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setSurfaceError(null);

      const next = searchParams.get('next');
      const redirectPath = getSafeAuthCallbackRedirectPath(next);
      const implicitHashSnapshot =
        typeof window !== 'undefined' ? window.location.hash : '';

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
        const supabase = createBrowserClient();

        const {
          data: { user: existingUser },
          error: existingUserError,
        } = await supabase.auth.getUser();
        if (cancelled) return;
        if (
          existingUserError &&
          !isAuthSessionMissingError(existingUserError)
        ) {
          throw existingUserError;
        }

        if (existingUser) {
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
            const { error: setSessionError } = await supabase.auth.setSession({
              access_token,
              refresh_token,
            });
            if (cancelled) return;
            if (setSessionError) {
              finishErr(AUTH_CALLBACK_INVALID_LINK_MESSAGE);
              return;
            }

            const {
              data: { user: userAfterSetSession },
              error: userAfterSetSessionError,
            } = await supabase.auth.getUser();
            if (cancelled) return;
            if (userAfterSetSessionError) {
              if (isAuthSessionMissingError(userAfterSetSessionError)) {
                finishErr(AUTH_CALLBACK_INVALID_LINK_MESSAGE);
                return;
              }
              throw userAfterSetSessionError;
            }
            if (userAfterSetSession) {
              finishOk();
              return;
            }
            finishErr(AUTH_CALLBACK_INVALID_LINK_MESSAGE);
            return;
          }
        }

        const {
          data: { user: afterDetectUser },
          error: afterDetectUserError,
        } = await supabase.auth.getUser();
        if (cancelled) return;
        if (afterDetectUserError) {
          if (isAuthSessionMissingError(afterDetectUserError)) {
            finishErr(AUTH_CALLBACK_INVALID_LINK_MESSAGE);
            return;
          }
          throw afterDetectUserError;
        }

        if (afterDetectUser) {
          finishOk();
          return;
        }

        finishErr(AUTH_CALLBACK_INVALID_LINK_MESSAGE);
      } catch (err) {
        if (cancelled) return;
        if (isAuthSessionMissingError(err)) {
          finishErr(AUTH_CALLBACK_INVALID_LINK_MESSAGE);
          return;
        }
        if (isSupabaseBrowserConfigError(err)) {
          setSurfaceError(err.message);
          return;
        }
        if (isSupabaseAuthApiError(err) && !isAuthSessionMissingError(err)) {
          console.error(
            'Failed to verify user during auth callback fragment handling',
            err,
          );
        } else if (!isAuthSessionMissingError(err)) {
          console.error(
            'Unexpected error during auth callback fragment handling',
            err,
          );
        }
        finishErr(AUTH_CALLBACK_VERIFICATION_FAILED_MESSAGE);
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
