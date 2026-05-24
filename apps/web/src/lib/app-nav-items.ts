import type { AppSideNavItem } from '@abstrack/ui-web';

/**
 * Primary authenticated routes for the user web app side navigation.
 */
export const WEB_APP_NAV_ITEMS: AppSideNavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    match: (path) => path === '/dashboard' || path.startsWith('/dashboard/'),
  },
  {
    href: '/manage',
    label: 'Manage',
    match: (path) => path === '/manage' || path.startsWith('/manage/'),
  },
  {
    href: '/insights',
    label: 'Insights',
    match: (path) => path === '/insights' || path.startsWith('/insights/'),
  },
  {
    href: '/presets/symptoms',
    label: 'Symptom presets',
    match: (path) =>
      path === '/presets/symptoms' || path.startsWith('/presets/symptoms/'),
  },
  {
    href: '/presets/health-markers',
    label: 'Health marker presets',
    match: (path) =>
      path === '/presets/health-markers' ||
      path.startsWith('/presets/health-markers/'),
  },
  {
    href: '/presets/episode-templates',
    label: 'Episode templates',
    match: (path) =>
      path === '/presets/episode-templates' ||
      path.startsWith('/presets/episode-templates/'),
  },
  {
    href: '/settings',
    label: 'Settings',
    match: (path) => path === '/settings' || path.startsWith('/settings/'),
  },
];
