import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const pushMock = jest.fn();
const refreshMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

jest.mock('@abstrack/ui/a11y-web', () => ({
  useAnnounce: () => ({ announce: jest.fn() }),
}));

const listFactorsMock = jest.fn();
const getAuthenticatorAssuranceLevelMock = jest.fn();
const challengeMock = jest.fn();
const verifyMock = jest.fn();
const getUserMock = jest.fn();
const signOutMock = jest.fn();

jest.mock('../../lib/supabase/browser-client', () => ({
  createBrowserClient: () => ({
    auth: {
      getUser: (...args: unknown[]) => getUserMock(...args),
      signOut: (...args: unknown[]) => signOutMock(...args),
      mfa: {
        listFactors: (...args: unknown[]) => listFactorsMock(...args),
        getAuthenticatorAssuranceLevel: (...args: unknown[]) =>
          getAuthenticatorAssuranceLevelMock(...args),
        challenge: (...args: unknown[]) => challengeMock(...args),
        verify: (...args: unknown[]) => verifyMock(...args),
      },
    },
  }),
}));

jest.mock('@abstrack/supabase', () => ({
  signInWithEmailPassword: jest.fn(async () => ({ error: null })),
}));

jest.mock('../../lib/user-mfa-device-trust', () => ({
  isUserMfaDeviceTrustEnabled: () => true,
  tryRestoreTrustedMfaSession: jest.fn(async () => ({
    status: 'not_restored',
  })),
  clearMfaTrustBundle: jest.fn(),
  saveMfaTrustBundle: jest.fn(),
  getTrustedUntilMsForDuration: (duration: string) =>
    Date.now() + (duration === '1_year' ? 365 : 30) * 24 * 60 * 60 * 1000,
}));

import { signInWithEmailPassword } from '@abstrack/supabase';
import { UserLoginForm } from './UserLoginForm';

describe('UserLoginForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getUserMock.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'a@example.com' } },
      error: null,
    });
    listFactorsMock.mockResolvedValue({
      data: {
        totp: [{ id: 'factor-1', status: 'verified', friendly_name: 'Phone' }],
      },
      error: null,
    });
    getAuthenticatorAssuranceLevelMock.mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal2' },
      error: null,
    });
  });

  it('shows MFA step after password sign-in when a verified TOTP factor exists', async () => {
    render(<UserLoginForm />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'a@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => {
      expect(signInWithEmailPassword).toHaveBeenCalled();
      expect(screen.getByLabelText(/authenticator code/i)).toBeInTheDocument();
    });
    expect(
      screen.getByLabelText(/do not ask again for 30 days/i),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/do not ask again for 1 year/i),
    ).toBeInTheDocument();
  });
});
