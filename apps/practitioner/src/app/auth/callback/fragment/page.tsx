'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  isAuthSessionMissingError,
  isSupabaseAuthApiError,
} from '@abstrack/supabase';
import { getSupabaseBrowserClient } from '@abstrack/supabase/browser';
import {
  AUTH_CALLBACK_INVALID_LINK_MESSAGE,
  AUTH_CALLBACK_VERIFICATION_FAILED_MESSAGE,
  getSafePractitionerAuthCallbackRedirectPath,
} from '@/lib/auth-callback-redirect';
import {
  interpretAuthCallbackGetUserProbe,
  isSupabaseBrowserConfigError,
  parseImplicitHashParams,
} from '@/lib/auth-callback-fragment-helpers';

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
 * rewritten here from `src/proxy.ts` (Next.js 16 proxy). PKCE (`?code=`) is handled in the parent
 * `route.ts` on the server so session cookies are set without exchanging the code in client JS.
 *
 * `AuthSessionMissingError` from `getUser()` means no existing session (signed out), not a
 * verification failure — the handler continues to `setSession()` from the hash when present.
 *
 * @returns Fragment callback UI (brief loading state).
 */
export default function PractitionerAuthCallbackFragmentPage() {
  return (
    <Suspense
      fallback={
        <main
          id="main-content"
          aria-live="polite"
          className="mx-auto max-w-lg p-6 text-base text-neutral-700"
        >
          Finishing sign-in…
        </main>
      }
    >
      <PractitionerAuthCallbackFragmentContent />
    </Suspense>
  );
}

function PractitionerAuthCallbackFragmentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [surfaceError, setSurfaceError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setSurfaceError(null);

      const next = searchParams.get('next');
      const redirectPath = getSafePractitionerAuthCallbackRedirectPath(next);
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
        const supabase = getSupabaseBrowserClient();

        const {
          data: { user: existingUser },
          error: existingUserError,
        } = await supabase.auth.getUser();
        if (cancelled) return;

        const existingUserProbe = interpretAuthCallbackGetUserProbe(
          existingUser,
          existingUserError,
        );
        if (existingUserProbe.status === 'verification_failed') {
          throw existingUserProbe.error;
        }
        if (existingUserProbe.status === 'authenticated') {
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
            // Implicit grant succeeded; do not require getUser() immediately after (signed-out
            // visitors often still report AuthSessionMissingError until the client catches up).
            finishOk();
            return;
          }
        }

        const {
          data: { user: afterHashUser },
          error: afterHashUserError,
        } = await supabase.auth.getUser();
        if (cancelled) return;

        const afterHashProbe = interpretAuthCallbackGetUserProbe(
          afterHashUser,
          afterHashUserError,
        );
        if (afterHashProbe.status === 'verification_failed') {
          throw afterHashProbe.error;
        }
        if (afterHashProbe.status === 'authenticated') {
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
      <main
        id="main-content"
        role="alert"
        className="mx-auto max-w-lg p-6 text-base text-red-700"
      >
        {surfaceError}
      </main>
    );
  }

  return (
    <main
      id="main-content"
      aria-live="polite"
      className="mx-auto max-w-lg p-6 text-base text-neutral-700"
    >
      Finishing sign-in…
    </main>
  );
}
