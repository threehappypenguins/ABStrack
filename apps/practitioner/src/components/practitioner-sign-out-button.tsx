'use client';

import { getSupabaseBrowserClient } from '@abstrack/supabase/browser';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { ACCOUNT_ACTIONS_SURFACE_CLASS } from '@abstrack/ui-web';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  isPractitionerMfaDeviceTrustActive,
  practitionerSignOut,
  practitionerSignOutEverywhere,
} from '@/lib/practitioner-device-trust';

export type PractitionerSignOutButtonProps = {
  /** Visible button label for the default (session-aware) sign-out. */
  label?: string;
  /**
   * Tailwind / layout classes for the primary sign-out control. When omitted, a built-in surface
   * style is used; pass a string to override completely.
   */
  className?: string;
};

/**
 * Practitioner sign-out: default action respects MFA device trust (soft local clear) when active;
 * secondary action performs full server sign-out via `POST /api/auth/logout`. Primary and secondary
 * buttons share {@link ACCOUNT_ACTIONS_SURFACE_CLASS} with user web top nav; pass `className` on the
 * primary control only to override.
 *
 * @param props - Labels and styling.
 * @returns Accessible sign-out controls and optional trust explanation.
 */
export function PractitionerSignOutButton({
  label = 'Log out',
  className,
}: PractitionerSignOutButtonProps) {
  const primaryClassName = className ?? ACCOUNT_ACTIONS_SURFACE_CLASS;
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
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!mountedRef.current) {
          return;
        }
        setTrustActive(isPractitionerMfaDeviceTrustActive(user?.id));
      } catch (syncError) {
        console.error(
          'Practitioner sign-out button: session sync failed',
          syncError,
        );
        if (!mountedRef.current) {
          return;
        }
        setTrustActive(false);
      }
    };

    void sync();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void sync();
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
        if (!mountedRef.current) {
          return;
        }
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
          without revoking the saved trust token so you can skip TOTP on the
          next sign-in here. On a shared computer, use Sign out everywhere.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="practitioner-sign-out"
          className={primaryClassName}
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
          className={ACCOUNT_ACTIONS_SURFACE_CLASS}
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
