'use client';

import { ACCOUNT_ACTIONS_SURFACE_CLASS } from '@abstrack/ui-web';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { useCallback } from 'react';

/**
 * MVP placeholder sign-in controls for the public landing top nav (desktop and mobile sheet).
 *
 * @returns Patient and practitioner sign-in placeholder buttons.
 */
export function LandingTopNavActions() {
  const { announce } = useAnnounce();

  const onMvpPlaceholder = useCallback(
    (label: string) => {
      announce(`${label} will be available after ABStrack reaches MVP.`, {
        politeness: 'polite',
      });
    },
    [announce],
  );

  return (
    <nav
      className="flex flex-wrap items-center gap-2"
      aria-label="Sign-in (not yet active)"
    >
      <button
        type="button"
        className={ACCOUNT_ACTIONS_SURFACE_CLASS}
        onClick={() => onMvpPlaceholder('Patient sign-in')}
      >
        Patient sign-in
        <span className="ml-1 text-xs font-normal text-app-muted">
          coming soon
        </span>
      </button>
      <button
        type="button"
        className={ACCOUNT_ACTIONS_SURFACE_CLASS}
        onClick={() => onMvpPlaceholder('Practitioner sign-in')}
      >
        Practitioner sign-in
        <span className="ml-1 text-xs font-normal text-app-muted">
          coming soon
        </span>
      </button>
    </nav>
  );
}
