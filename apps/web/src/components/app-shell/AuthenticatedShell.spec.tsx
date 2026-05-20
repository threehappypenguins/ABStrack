import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
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

jest.mock('@abstrack/ui', () => ({
  NavigationShell: ({
    children,
    header,
  }: {
    children: ReactNode;
    header?: ReactNode;
  }) => (
    <div>
      <div data-testid="nav-shell-header">{header}</div>
      <div data-testid="nav-shell-main">{children}</div>
    </div>
  ),
}));

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
  });

  it('hides patient-only settings links when the viewer is not a patient', () => {
    phiContext.profileAppRole = 'caretaker';

    render(
      <AuthenticatedShell email="caretaker@example.com">
        <p>Page content</p>
      </AuthenticatedShell>,
    );

    expect(
      screen.queryByRole('link', { name: 'Caretaker' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Practitioner' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Insights' })).toBeInTheDocument();
  });
});
