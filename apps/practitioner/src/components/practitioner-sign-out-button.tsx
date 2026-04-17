'use client';

import { getSupabaseBrowserClient } from '@abstrack/supabase/browser';
import { useMemo } from 'react';
import { practitionerSignOut } from '@/lib/practitioner-device-trust';

export type PractitionerSignOutButtonProps = {
  /** Visible button label. */
  label?: string;
  /** Tailwind / layout classes (match previous `<form><button>` styling). */
  className?: string;
};

/**
 * Practitioner sign-out: respects MFA device trust (soft local clear) vs full Supabase revocation.
 *
 * @param props - Label and styling.
 * @returns Accessible button that signs out and navigates to `/login`.
 */
export function PractitionerSignOutButton({
  label = 'Log out',
  className,
}: PractitionerSignOutButtonProps) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  return (
    <button
      type="button"
      data-testid="practitioner-sign-out"
      className={className}
      onClick={() => void practitionerSignOut(supabase)}
    >
      {label}
    </button>
  );
}
