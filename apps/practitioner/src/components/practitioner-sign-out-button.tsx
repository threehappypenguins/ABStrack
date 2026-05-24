'use client';

import { getSupabaseBrowserClient } from '@abstrack/supabase/browser';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { ACCOUNT_ACTIONS_SURFACE_CLASS } from '@abstrack/ui-web';
import { useEffect, useMemo, useRef, useState } from 'react';
import { practitionerSignOut } from '@/lib/practitioner-device-trust';
import {
  clearPractitionerSignOutPending,
  markPractitionerSignOutPending,
} from '@/lib/practitioner-sign-out-pending';

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
 * Practitioner sign-out: respects MFA device trust (soft local clear) when active, otherwise
 * performs a full `signOut()`. Full sign-out on all devices lives in Settings.
 *
 * @param props - Labels and styling.
 * @returns Accessible sign-out control.
 */
export function PractitionerSignOutButton({
  label = 'Log out',
  className,
}: PractitionerSignOutButtonProps) {
  const primaryClassName = className ?? ACCOUNT_ACTIONS_SURFACE_CLASS;
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const { announce } = useAnnounce();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleLocalSignOut = () => {
    if (signingOut) {
      return;
    }
    setError(null);
    setSigningOut(true);
    markPractitionerSignOutPending();
    void practitionerSignOut(supabase)
      .catch((err: unknown) => {
        console.error('Practitioner sign out failed', err);
        clearPractitionerSignOutPending();
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

  return (
    <div className="inline-flex max-w-full flex-col gap-2">
      <button
        type="button"
        data-testid="practitioner-sign-out"
        className={primaryClassName}
        disabled={signingOut}
        {...(signingOut ? { 'aria-busy': true as const } : {})}
        onClick={handleLocalSignOut}
      >
        {signingOut ? 'Signing out…' : label}
      </button>
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
