'use client';

import { getSupabaseBrowserClient } from '@abstrack/supabase/browser';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  isPractitionerMfaDeviceTrustActive,
  practitionerSignOut,
  practitionerSignOutEverywhere,
} from '@/lib/practitioner-device-trust';

const SECONDARY_SIGN_OUT_CLASS =
  'min-h-11 rounded-md border border-app-border bg-app-surface px-4 py-2 text-sm font-medium text-app-ink shadow-sm transition hover:bg-[var(--app-nav-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg';

export type PractitionerSignOutButtonProps = {
  /** Visible button label for the default (session-aware) sign-out. */
  label?: string;
  /** Tailwind / layout classes for the primary sign-out control. */
  className?: string;
};

/**
 * Practitioner sign-out: default action respects MFA device trust (soft local clear) when active;
 * secondary action performs full server sign-out via `POST /api/auth/logout`.
 *
 * @param props - Labels and styling.
 * @returns Accessible sign-out controls and optional trust explanation.
 */
export function PractitionerSignOutButton({
  label = 'Log out',
  className,
}: PractitionerSignOutButtonProps) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const { announce } = useAnnounce();
  const [signingOut, setSigningOut] = useState(false);
  /** True after choosing full server sign-out until navigation completes. */
  const [signingOutEverywhere, setSigningOutEverywhere] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const [trustActive, setTrustActive] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const sync = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setTrustActive(isPractitionerMfaDeviceTrustActive(session?.user?.id));
    };

    void sync();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setTrustActive(isPractitionerMfaDeviceTrustActive(session?.user?.id));
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  const handleLocalSignOut = () => {
    if (signingOut) {
      return;
    }
    setError(null);
    setSigningOut(true);
    void practitionerSignOut(supabase)
      .catch((err: unknown) => {
        console.error('Practitioner sign out failed', err);
        const message =
          err instanceof Error
            ? err.message
            : 'Sign out failed. Please try again.';
        setError(message);
        announce(message, { politeness: 'assertive' });
      })
      .finally(() => {
        if (mountedRef.current) {
          setSigningOut(false);
        }
      });
  };

  const handleSignOutEverywhere = () => {
    if (signingOut || signingOutEverywhere) {
      return;
    }
    setError(null);
    setSigningOutEverywhere(true);
    announce('Signing out from all sessions.', { politeness: 'polite' });
    practitionerSignOutEverywhere();
  };

  const busy = signingOut || signingOutEverywhere;

  return (
    <div className="inline-flex max-w-full flex-col gap-2">
      {trustActive ? (
        <p
          id="practitioner-sign-out-trust-hint"
          className="max-w-prose text-xs text-app-muted"
        >
          Device trust is on: &quot;{label}&quot; clears this browser session
          but can let you skip TOTP on the next sign-in here. On a shared
          computer, use Sign out everywhere.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="practitioner-sign-out"
          className={className}
          disabled={busy}
          {...(busy ? { 'aria-busy': true as const } : {})}
          aria-describedby={
            trustActive ? 'practitioner-sign-out-trust-hint' : undefined
          }
          onClick={handleLocalSignOut}
        >
          {busy ? 'Signing out…' : label}
        </button>
        <button
          type="button"
          data-testid="practitioner-sign-out-everywhere"
          className={SECONDARY_SIGN_OUT_CLASS}
          disabled={busy}
          {...(signingOutEverywhere ? { 'aria-busy': true as const } : {})}
          onClick={handleSignOutEverywhere}
        >
          {signingOutEverywhere ? 'Signing out…' : 'Sign out everywhere'}
        </button>
      </div>
      {error ? (
        <p
          role="alert"
          className="max-w-prose text-sm text-red-700 dark:text-red-200"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
