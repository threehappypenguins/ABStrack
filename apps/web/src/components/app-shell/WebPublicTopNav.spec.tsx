import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const usePathnameMock = jest.fn(() => '/');

const authState: {
  session: { user: { email?: string } } | null;
  loading: boolean;
} = {
  session: null,
  loading: false,
};

jest.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
}));

jest.mock('../../lib/auth-provider', () => ({
  useAuth: () => authState,
}));

jest.mock('../theme/ThemeMenu', () => ({
  ThemeMenu: () => <button type="button">Theme</button>,
}));

jest.mock('./LandingTopNavActions', () => ({
  LandingTopNavActions: () => (
    <nav aria-label="Sign-in (not yet active)">Landing actions</nav>
  ),
}));

jest.mock('@abstrack/ui-web', () => {
  const actual =
    jest.requireActual<typeof import('@abstrack/ui-web')>('@abstrack/ui-web');

  return {
    ...actual,
    AppTopNav: ({
      actions,
      tagline,
    }: {
      actions?: ReactNode;
      tagline: string;
    }) => (
      <header data-testid="app-top-nav" data-tagline={tagline}>
        {actions}
        <button type="button">Theme</button>
      </header>
    ),
  };
});

import { WebPublicTopNav } from './WebPublicTopNav';

function renderTopNav(pathname: string) {
  usePathnameMock.mockReturnValue(pathname);
  return render(<WebPublicTopNav />);
}

describe('WebPublicTopNav', () => {
  beforeEach(() => {
    authState.session = null;
    authState.loading = false;
    usePathnameMock.mockReturnValue('/');
  });

  it('renders landing actions on /', () => {
    renderTopNav('/');

    expect(screen.getByTestId('app-top-nav')).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Sign-in (not yet active)' }),
    ).toBeInTheDocument();
  });

  it('renders Sign up on /login and Login on /signup', () => {
    renderTopNav('/login');

    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute(
      'href',
      '/signup',
    );

    renderTopNav('/signup');

    expect(screen.getByRole('link', { name: 'Login' })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('renders the shared web tagline on public routes', () => {
    renderTopNav('/forgot-password');

    expect(screen.getByTestId('app-top-nav')).toHaveAttribute(
      'data-tagline',
      'Auto-Brewery Syndrome Tracking',
    );
  });

  it('returns null on private routes while auth is loading', () => {
    authState.loading = true;
    authState.session = null;

    renderTopNav('/dashboard');

    expect(screen.queryByTestId('app-top-nav')).not.toBeInTheDocument();
  });

  it('returns null on private routes when signed in', () => {
    authState.loading = false;
    authState.session = { user: { email: 'user@example.com' } };

    renderTopNav('/insights');

    expect(screen.queryByTestId('app-top-nav')).not.toBeInTheDocument();
  });

  it('still renders on signed-out private routes after auth resolves', () => {
    authState.loading = false;
    authState.session = null;

    renderTopNav('/patients');

    expect(screen.getByTestId('app-top-nav')).toBeInTheDocument();
  });
});
