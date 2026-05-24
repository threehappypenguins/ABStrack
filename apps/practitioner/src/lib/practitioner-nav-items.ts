import type { AppSideNavItem } from '@abstrack/ui-web';

/**
 * Primary practitioner app routes for the side navigation.
 */
export const PRACTITIONER_APP_NAV_ITEMS: AppSideNavItem[] = [
  {
    href: '/',
    label: 'Home',
    match: (path) => path === '/',
  },
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
