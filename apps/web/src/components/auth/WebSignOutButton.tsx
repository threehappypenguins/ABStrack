'use client';

import { ACCOUNT_ACTIONS_SURFACE_CLASS } from '@abstrack/ui-web';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-provider';
import { userSignOut } from '@/lib/user-mfa-device-trust';

/**
 * Sign-out control that preserves MFA device trust when the user opted in for 30 days
 * (soft sign-out clears browser session only; full logout revokes server tokens).
 *
 * @returns Log out button for the authenticated shell.
 */
export function WebSignOutButton() {
  const { supabase } = useAuth();
  const [loading, setLoading] = useState(false);

  return (
    <button
      type="button"
      disabled={loading}
      className={ACCOUNT_ACTIONS_SURFACE_CLASS}
      onClick={() => {
        setLoading(true);
        void userSignOut(supabase).finally(() => {
          setLoading(false);
        });
      }}
    >
      {loading ? 'Signing out…' : 'Log out'}
    </button>
  );
}
