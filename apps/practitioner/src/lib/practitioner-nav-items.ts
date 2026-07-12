import type { AppSideNavItem } from '@abstrack/ui-web';

/**
 * Primary practitioner app routes for the side navigation.
 * Brand / logo links to `/` (proxy redirects signed-in users to `/patients`, signed-out to `/login`).
 * TOTP setup is under `/mfa` and Settings.
 */
export const PRACTITIONER_APP_NAV_ITEMS: AppSideNavItem[] = [
  {
    href: '/patients',
    label: 'Patients',
    match: (path) => path === '/patients' || path.startsWith('/patients/'),
  },
  {
    href: '/settings',
    label: 'Settings',
    match: (path) => path === '/settings' || path.startsWith('/settings/'),
  },
];
