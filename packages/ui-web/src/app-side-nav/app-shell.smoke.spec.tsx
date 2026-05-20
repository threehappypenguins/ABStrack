import { render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import { describe, expect, it } from 'vitest';

import {
  AppShellWithSideNav,
  AppSideNav,
  type AppSideNavItem,
  type AppSideNavLinkProps,
} from '../index.js';

const TestNavLink = forwardRef<HTMLAnchorElement, AppSideNavLinkProps>(
  ({ href, children, ...rest }, ref) => (
    <a href={href} ref={ref} {...rest}>
      {children}
    </a>
  ),
);
TestNavLink.displayName = 'TestNavLink';

const navItems: AppSideNavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    match: (pathname) => pathname === '/dashboard',
  },
];

describe('@abstrack/ui-web shell smoke', () => {
  it('renders AppShellWithSideNav with main landmark and side nav', () => {
    render(
      <AppShellWithSideNav
        sideNav={
          <AppSideNav
            pathname="/dashboard"
            items={navItems}
            LinkComponent={TestNavLink}
            accessibilityLabel="Test app"
          />
        }
      >
        <p>Page body</p>
      </AppShellWithSideNav>,
    );

    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toHaveAttribute('tabindex', '-1');
    expect(screen.getByText('Page body')).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Test app' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
  });
});
