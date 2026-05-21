import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const usePathnameMock = jest.fn(() => '/dashboard');

const authState: {
  session: { user: { email?: string } } | null;
  loading: boolean;
} = {
  session: null,
  loading: true,
};

jest.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
}));

jest.mock('../../lib/auth-provider', () => ({
  useAuth: () => authState,
}));

jest.mock('./AuthenticatedShell', () => ({
  AuthenticatedShell: ({
    children,
    email,
  }: {
    children: ReactNode;
    email?: string | null;
  }) => (
    <div data-testid="authenticated-shell" data-email={email ?? ''}>
      {children}
    </div>
  ),
}));

import { WebAppShell } from './WebAppShell';

function renderShell(pathname: string, childText = 'Page content') {
  usePathnameMock.mockReturnValue(pathname);
  return render(
    <WebAppShell>
      <p data-testid="page-child">{childText}</p>
    </WebAppShell>,
  );
}

function interimWrapper(): HTMLElement | null {
  const child = screen.getByTestId('page-child');
  const parent = child.parentElement;
  return parent?.classList.contains('app-grid-background') ? parent : null;
}

describe('WebAppShell', () => {
  beforeEach(() => {
    authState.session = null;
    authState.loading = true;
    usePathnameMock.mockReturnValue('/dashboard');
  });

  it('passes through children on public routes without an interim wrapper', () => {
    const { container } = renderShell('/login');

    expect(screen.getByTestId('page-child')).toBeInTheDocument();
    expect(screen.queryByTestId('authenticated-shell')).not.toBeInTheDocument();
    expect(interimWrapper()).toBeNull();
    expect(container.querySelector('.app-grid-background')).toBeNull();
  });

  it('wraps private routes in an interim grid div while auth is loading', () => {
    authState.loading = true;
    authState.session = null;

    renderShell('/dashboard');

    const wrapper = interimWrapper();
    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveClass('min-h-svh');
    expect(wrapper).not.toHaveAttribute('id', 'main-content');
    expect(screen.queryByTestId('authenticated-shell')).not.toBeInTheDocument();
  });

  it('uses header-adjusted min height on signed-out private routes', () => {
    authState.loading = false;
    authState.session = null;

    renderShell('/patients');

    const wrapper = interimWrapper();
    expect(wrapper).toHaveClass('min-h-[calc(100svh-4.5rem)]');
    expect(wrapper).not.toHaveClass('min-h-svh');
  });

  it('renders AuthenticatedShell when signed in on a private route', () => {
    authState.loading = false;
    authState.session = { user: { email: 'user@example.com' } };

    renderShell('/dashboard');

    expect(screen.getByTestId('authenticated-shell')).toHaveAttribute(
      'data-email',
      'user@example.com',
    );
    expect(screen.getByTestId('page-child')).toBeInTheDocument();
    expect(interimWrapper()).toBeNull();
  });
});
