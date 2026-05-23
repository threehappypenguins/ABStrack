import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import { WEB_APP_NAV_ITEMS } from '@/lib/app-nav-items';
import type { ReactNode } from 'react';

const usePathnameMock = jest.fn(() => '/dashboard');

const phiContext = {
  profileAppRole: 'patient' as 'patient' | 'caretaker' | 'practitioner',
  authUserId: 'user-1',
  phiSubjectUserId: 'user-1',
  loading: false,
  errorMessage: null as string | null,
  refresh: jest.fn(),
};

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...rest
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

jest.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
}));

jest.mock('../../lib/patient/use-web-phi-subject-user-context', () => ({
  useWebPhiSubjectUserContext: () => phiContext,
}));

jest.mock('../theme/ThemeMenu', () => ({
  ThemeMenu: () => <button type="button">Theme</button>,
}));

jest.mock('@abstrack/ui-web', () => {
  const actual =
    jest.requireActual<typeof import('@abstrack/ui-web')>('@abstrack/ui-web');

  return {
    ...actual,
    AppShellWithSideNav: ({
      children,
      topHeader,
      sideNav,
    }: {
      children: ReactNode;
      topHeader?: ReactNode;
      sideNav?: ReactNode;
    }) => (
      <div>
        <div data-testid="app-shell-top-header">{topHeader}</div>
        <div data-testid="app-side-nav">{sideNav}</div>
        <div data-testid="app-shell-main">{children}</div>
      </div>
    ),
    AppTopNav: ({
      email,
      actions,
      themeMenu,
      tagline,
    }: {
      email?: string | null;
      actions?: ReactNode;
      themeMenu: ReactNode;
      tagline: string;
    }) => (
      <header data-testid="app-top-nav">
        <a aria-label={`ABStrack ${tagline}`}>ABStrack</a>
        {email ? <p>{email}</p> : null}
        {actions}
        {themeMenu}
      </header>
    ),
    AppSideNav: ({
      items,
    }: {
      items: Array<{ href: string; label: string }>;
    }) => (
      <nav aria-label="ABStrack application">
        {items.map((item) => (
          <a key={item.href} href={item.href}>
            {item.label}
          </a>
        ))}
      </nav>
    ),
  };
});

import { AuthenticatedShell } from './AuthenticatedShell';

describe('AuthenticatedShell', () => {
  beforeEach(() => {
    phiContext.profileAppRole = 'patient';
    usePathnameMock.mockReturnValue('/dashboard');
  });

  it('renders primary nav including Insights alongside existing routes', () => {
    render(
      <AuthenticatedShell email="patient@example.com">
        <p>Page content</p>
      </AuthenticatedShell>,
    );

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(screen.getByRole('link', { name: 'Manage' })).toHaveAttribute(
      'href',
      '/manage',
    );
    expect(screen.getByRole('link', { name: 'Insights' })).toHaveAttribute(
      'href',
      '/insights',
    );
    expect(
      screen.getByRole('link', { name: 'Health marker presets' }),
    ).toHaveAttribute('href', '/presets/health-markers');
    expect(screen.getByText('Page content')).toBeInTheDocument();
    expect(
      screen.getByLabelText('ABStrack Auto-Brewery Syndrome Tracking'),
    ).toBeInTheDocument();
  });

  it('shows Settings as the last nav item for all signed-in roles', () => {
    phiContext.profileAppRole = 'caretaker';

    render(
      <AuthenticatedShell email="caretaker@example.com">
        <p>Page content</p>
      </AuthenticatedShell>,
    );

    const nav = screen.getByRole('navigation', {
      name: 'ABStrack application',
    });
    const navLinkLabels = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent?.trim());
    expect(navLinkLabels).toEqual(WEB_APP_NAV_ITEMS.map((item) => item.label));
    expect(navLinkLabels.at(-1)).toBe('Settings');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
    expect(
      screen.queryByRole('link', { name: 'Caretaker' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Practitioner' }),
    ).not.toBeInTheDocument();
  });
});
