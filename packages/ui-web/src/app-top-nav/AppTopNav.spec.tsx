import { fireEvent, render, screen, within } from '@testing-library/react';
import { forwardRef, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { SidebarProvider } from '../components/sidebar.js';
import { AppTopNav, type AppTopNavBrandLinkProps } from './AppTopNav.js';

const TestBrandLink = forwardRef<HTMLAnchorElement, AppTopNavBrandLinkProps>(
  ({ href, children, ...rest }, ref) => (
    <a href={href} ref={ref} {...rest}>
      {children}
    </a>
  ),
);
TestBrandLink.displayName = 'TestBrandLink';

function renderTopNav(ui: ReactNode) {
  return render(<SidebarProvider>{ui}</SidebarProvider>);
}

describe('AppTopNav', () => {
  it('renders logo, wordmark, desktop account chrome, and side nav trigger', () => {
    renderTopNav(
      <AppTopNav
        brandHref="/dashboard"
        brandLinkComponent={TestBrandLink}
        tagline="Auto-Brewery Syndrome Tracking"
        email="user@example.com"
        themeMenu={<button type="button">Theme</button>}
        showSidebarTrigger
        actions={
          <button type="button" data-testid="sign-out">
            Log out
          </button>
        }
        mobileSheetTitle="Account"
        mobileMenuTriggerAriaLabel="Open account menu"
      />,
    );

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(
      screen
        .getByRole('link', { name: /ABStrack Auto-Brewery Syndrome Tracking/i })
        .querySelector('img'),
    ).toHaveAttribute('src', '/logo.png');
    expect(
      screen.getByRole('link', {
        name: /ABStrack Auto-Brewery Syndrome Tracking/i,
      }),
    ).toHaveAttribute('href', '/dashboard');
    expect(screen.getByText('ABStrack')).toBeInTheDocument();
    expect(
      screen.getByText('Auto-Brewery Syndrome Tracking'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Signed in as user@example.com'),
    ).toHaveTextContent('user@example.com');
    expect(screen.getByTestId('sign-out')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Theme' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open navigation menu' }),
    ).toBeInTheDocument();
  });

  it('opens the mobile account sheet with email, sign out, and theme', () => {
    renderTopNav(
      <AppTopNav
        brandHref="/"
        brandLinkComponent={TestBrandLink}
        tagline="Auto-Brewery Syndrome Tracking"
        email="doc@example.com"
        themeMenu={<button type="button">Theme</button>}
        showSidebarTrigger
        actions={<button type="button">Log out</button>}
        mobileSheetTitle="Account"
        mobileMenuTriggerAriaLabel="Open account menu"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open account menu' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Account' }),
    ).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('doc@example.com');
    expect(dialog).toHaveTextContent('Log out');
    expect(
      within(dialog).getByRole('button', { name: 'Theme' }),
    ).toBeInTheDocument();
  });

  it('renders public chrome without a sidebar trigger', () => {
    render(
      <AppTopNav
        brandHref="/"
        brandLinkComponent={TestBrandLink}
        tagline="Auto-Brewery Syndrome Tracking"
        themeMenu={<button type="button">Theme</button>}
        actions={
          <a href="/login" className="auth-link">
            Login
          </a>
        }
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Open navigation menu' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Login' })).toHaveAttribute(
      'href',
      '/login',
    );
  });
});
