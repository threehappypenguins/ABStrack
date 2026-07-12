import { render, screen } from '@testing-library/react';
import { LiveAnnouncerProvider } from '@abstrack/ui/a11y-web';
import Page from '../src/app/mfa/page';
import type { PractitionerSupabaseProfilesRow } from '../src/lib/supabase-wiring';
import { useAuth } from '../src/lib/auth-provider';
import type { Session } from '@abstrack/supabase';

jest.mock('../src/lib/auth-provider', () => ({
  useAuth: jest.fn(),
}));

const replaceMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

const mockedUseAuth = jest.mocked(useAuth);

/** Minimal session shape for gate branches that require `session?.access_token`. */
function sessionWithToken(): Session {
  return {
    access_token: 'test-access-token',
    refresh_token: '',
    expires_in: 3600,
    expires_at: undefined,
    token_type: 'bearer',
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'user@example.com',
      app_metadata: {},
      user_metadata: {},
      created_at: '',
    },
  } as Session;
}

function renderPage() {
  return render(
    <LiveAnnouncerProvider>
      <Page />
    </LiveAnnouncerProvider>,
  );
}

function expectPractitionerSignOutButton() {
  expect(screen.getByTestId('practitioner-sign-out')).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Log out$/i })).toBeTruthy();
  expect(screen.queryByTestId('practitioner-sign-out-everywhere')).toBeNull();
}

const patientProfileRow: PractitionerSupabaseProfilesRow = {
  id: '00000000-0000-0000-0000-000000000001',
  display_name: null,
  app_role: 'patient',
  created_at: '2020-01-01T00:00:00.000Z',
  updated_at: '2020-01-01T00:00:00.000Z',
};

/** MFA enrollment page calls `getSupabaseBrowserClient()` on mount; env-public throws without URL + key. */
const JEST_SUPABASE_URL = 'https://test.supabase.co';
const JEST_SUPABASE_KEY = 'sb_publishable_test_jest_placeholder';

describe('MfaEnrollmentPage', () => {
  let prevUrl: string | undefined;
  let prevKey: string | undefined;

  beforeAll(() => {
    prevUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
    prevKey = process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
    process.env['NEXT_PUBLIC_SUPABASE_URL'] = prevUrl ?? JEST_SUPABASE_URL;
    process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] =
      prevKey ?? JEST_SUPABASE_KEY;
  });

  afterAll(() => {
    if (prevUrl === undefined) {
      delete process.env['NEXT_PUBLIC_SUPABASE_URL'];
    } else {
      process.env['NEXT_PUBLIC_SUPABASE_URL'] = prevUrl;
    }
    if (prevKey === undefined) {
      delete process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
    } else {
      process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'] = prevKey;
    }
  });

  beforeEach(() => {
    replaceMock.mockClear();
    mockedUseAuth.mockReturnValue({
      session: null,
      loading: false,
      profile: undefined,
      profileError: null,
      accessTokenClaims: null,
      gate: { kind: 'signed_out' },
    });
  });

  it('should render successfully when signed out', () => {
    const { baseElement } = renderPage();
    expect(baseElement).toBeTruthy();
  });

  it('redirects signed-out visitors to /login', () => {
    renderPage();
    expect(replaceMock).toHaveBeenCalledWith('/login');
    expect(screen.getByText(/Redirecting to sign in/i)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /^Log in$/i })).toBeNull();
  });

  it('shows profile_error copy and practitioner sign-out control', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    mockedUseAuth.mockReturnValue({
      session: sessionWithToken(),
      loading: false,
      profile: null,
      profileError: new Error('simulated PostgREST failure'),
      accessTokenClaims: null,
      gate: {
        kind: 'profile_error',
        error: new Error('simulated PostgREST failure'),
      },
    });

    renderPage();

    expect(
      screen.getByRole('heading', { name: /Could not load your profile/i }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Something went wrong while loading your account/i),
    ).toBeTruthy();
    expect(screen.queryByText(/simulated PostgREST failure/i)).toBeNull();
    expectPractitionerSignOutButton();

    consoleSpy.mockRestore();
  });

  it('shows profile_missing copy and practitioner sign-out control', () => {
    mockedUseAuth.mockReturnValue({
      session: sessionWithToken(),
      loading: false,
      profile: null,
      profileError: null,
      accessTokenClaims: null,
      gate: { kind: 'profile_missing' },
    });

    renderPage();

    expect(
      screen.getByRole('heading', { name: /No profile for this account/i }),
    ).toBeTruthy();
    expect(
      screen.getByText(/does not have an ABStrack profile yet/i),
    ).toBeTruthy();
    expectPractitionerSignOutButton();
  });

  it('shows wrong_app_role copy and practitioner sign-out control', () => {
    mockedUseAuth.mockReturnValue({
      session: sessionWithToken(),
      loading: false,
      profile: patientProfileRow,
      profileError: null,
      accessTokenClaims: null,
      gate: { kind: 'wrong_app_role', appRole: 'patient' },
    });

    renderPage();

    expect(
      screen.getByRole('heading', { name: /Wrong account type for this app/i }),
    ).toBeTruthy();
    expect(screen.getByText(/healthcare practitioners/i)).toBeTruthy();
    expect(screen.getByText('patient')).toBeTruthy();
    expectPractitionerSignOutButton();
  });

  it('resolves @abstrack/supabase types', () => {
    const row: PractitionerSupabaseProfilesRow | null = null;
    expect(row).toBeNull();
  });
});
