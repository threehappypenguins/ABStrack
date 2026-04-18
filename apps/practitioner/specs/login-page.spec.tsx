import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { LiveAnnouncerProvider } from '@abstrack/ui/a11y-web';
import { getSupabaseBrowserClient } from '@abstrack/supabase/browser';
import LoginPage from '../src/app/login/page';
import {
  tryRestoreTrustedMfaSession,
  saveMfaTrustBundle,
  clearMfaTrustBundle,
  getTrustedUntilMsAfterVerification,
  refreshTrustedMfaBundleBeforePasswordSignIn,
  readMfaTrustBundle,
} from '../src/lib/practitioner-device-trust';

jest.mock('@abstrack/supabase/browser', () => ({
  getSupabaseBrowserClient: jest.fn(),
}));

jest.mock('../src/lib/practitioner-device-trust', () => {
  const actual = jest.requireActual<
    typeof import('../src/lib/practitioner-device-trust')
  >('../src/lib/practitioner-device-trust');
  return {
    ...actual,
    tryRestoreTrustedMfaSession: jest.fn(),
    saveMfaTrustBundle: jest.fn(),
    clearMfaTrustBundle: jest.fn(),
    getTrustedUntilMsAfterVerification: jest.fn(() => Date.now() + 86_400_000),
    refreshTrustedMfaBundleBeforePasswordSignIn: jest
      .fn()
      .mockResolvedValue(false),
    readMfaTrustBundle: jest.fn().mockReturnValue(null),
  };
});

const mockPush = jest.fn();
const mockRefresh = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

const mockedGetClient = jest.mocked(getSupabaseBrowserClient);
const mockedTryRestore = jest.mocked(tryRestoreTrustedMfaSession);
const mockedSaveBundle = jest.mocked(saveMfaTrustBundle);
const mockedClearBundle = jest.mocked(clearMfaTrustBundle);
const mockedTrustedUntil = jest.mocked(getTrustedUntilMsAfterVerification);
const mockedRefreshBeforePassword = jest.mocked(
  refreshTrustedMfaBundleBeforePasswordSignIn,
);
const mockedReadBundle = jest.mocked(readMfaTrustBundle);

const USER_ID = '00000000-0000-0000-0000-000000000042';
const FACTOR_ID = 'factor-totp-1';
const FACTOR_ID_2 = 'factor-totp-2';

/** Unsigned JWT for tests that need `parseAbstrackAccessTokenClaims` / `aal` (Node `Buffer`). */
function makeUnsignedJwtForTest(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'none', typ: 'JWT' }),
    'utf8',
  ).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  return `${header}.${body}.sig`;
}

/** Default mock access token with `aal: aal2` so login waits and `/patients` match the patient gate. */
const DEFAULT_SESSION_ACCESS_TOKEN_AAL2 = makeUnsignedJwtForTest({
  aal: 'aal2',
  sub: USER_ID,
});

type MfaMock = {
  signInWithPassword: jest.Mock;
  getUser: jest.Mock;
  listFactors: jest.Mock;
  getAuthenticatorAssuranceLevel: jest.Mock;
  getSession: jest.Mock;
  signOut: jest.Mock;
  challenge: jest.Mock;
  verify: jest.Mock;
};

/**
 * Builds a Supabase client mock for the practitioner login state machine. Defaults: password
 * sign-in succeeds, one verified TOTP factor, trust restore fails, assurance is aal1 then aal2
 * after MFA verify.
 */
function createLoginSupabaseMock(options?: {
  signInError?: { message: string } | null;
  getUserResponse?: {
    error: Error | null;
    user: { id: string } | null;
  };
  listFactors?: {
    error: Error | null;
    totp: Array<{
      id: string;
      status: string;
      friendly_name?: string | null;
    }>;
  };
  assuranceFirst?: { currentLevel: string; nextLevel: string | null };
  assuranceAfterVerify?: { currentLevel: string; nextLevel: string | null };
  verifyError?: unknown;
  /** Result of `getSession()` during MFA verify (only call site on this page). */
  mfaVerifyGetSession?: {
    error?: { message: string } | null;
    session?: {
      user: { id: string };
      refresh_token: string;
      access_token: string;
    } | null;
  };
  /** Access token for default `getSession()` results (e.g. JWT with `aal` for primed fast-path). */
  sessionAccessToken?: string;
}): { client: { auth: Record<string, unknown> }; mfa: MfaMock } {
  const signInError = options?.signInError ?? null;
  const totpList = options?.listFactors?.totp ?? [
    { id: FACTOR_ID, status: 'verified' },
  ];
  const listErr = options?.listFactors?.error ?? null;

  const signInWithPassword = jest
    .fn()
    .mockResolvedValue({ error: signInError });
  const getUserResolved = options?.getUserResponse ?? {
    error: null as Error | null,
    user: { id: USER_ID },
  };
  const getUser = jest.fn().mockResolvedValue({
    data: { user: getUserResolved.user },
    error: getUserResolved.error,
  });
  const listFactors = jest.fn().mockResolvedValue({
    error: listErr,
    data: { totp: totpList },
  });

  const assuranceFirst = options?.assuranceFirst ?? {
    currentLevel: 'aal1',
    nextLevel: 'aal2',
  };
  const assuranceAfterVerify = options?.assuranceAfterVerify ?? {
    currentLevel: 'aal2',
    nextLevel: 'aal2',
  };

  const getAuthenticatorAssuranceLevel = jest
    .fn()
    .mockResolvedValueOnce({
      error: null,
      data: assuranceFirst,
    })
    .mockResolvedValue({
      error: null,
      data: assuranceAfterVerify,
    });

  const defaultMfaSession = {
    user: { id: USER_ID },
    refresh_token: 'refresh-token',
    access_token:
      options?.sessionAccessToken ?? DEFAULT_SESSION_ACCESS_TOKEN_AAL2,
  };
  const mfaSessionOpts = options?.mfaVerifyGetSession;
  const verifyPhaseGetSessionResult = {
    data: {
      session:
        mfaSessionOpts?.session === undefined
          ? defaultMfaSession
          : mfaSessionOpts.session,
    },
    error: mfaSessionOpts?.error ?? null,
  };
  /** Login calls `getSession` after `tryRestoreTrustedMfaSession` before MFA; keep that success when verify-phase mocks simulate failure. */
  const postTrustRestoreGetSessionOk = {
    data: { session: defaultMfaSession },
    error: null as const,
  };
  const verifyPhaseDiffersFromHealthy =
    mfaSessionOpts != null &&
    (mfaSessionOpts.error != null || mfaSessionOpts.session === null);
  const getSession = verifyPhaseDiffersFromHealthy
    ? jest
        .fn()
        .mockResolvedValueOnce(postTrustRestoreGetSessionOk)
        .mockResolvedValue(verifyPhaseGetSessionResult)
    : jest.fn().mockResolvedValue(verifyPhaseGetSessionResult);
  const signOut = jest.fn().mockResolvedValue({ error: null });

  const challenge = jest.fn().mockResolvedValue({
    error: null,
    data: { id: 'challenge-id' },
  });
  const verify = options?.verifyError
    ? jest.fn().mockResolvedValue({ error: options.verifyError, data: null })
    : jest.fn().mockResolvedValue({ error: null, data: {} });

  const mfa: MfaMock = {
    signInWithPassword,
    getUser,
    listFactors,
    getAuthenticatorAssuranceLevel,
    getSession,
    signOut,
    challenge,
    verify,
  };

  const client = {
    auth: {
      signInWithPassword,
      getUser,
      getSession,
      signOut,
      mfa: {
        listFactors,
        getAuthenticatorAssuranceLevel,
        challenge,
        verify,
      },
    },
  };

  return { client, mfa };
}

function renderLogin() {
  return render(
    <LiveAnnouncerProvider>
      <LoginPage />
    </LiveAnnouncerProvider>,
  );
}

/**
 * Visible inline error is a `<p role="alert">`; `useAnnounce` also mounts a live-region `role="alert"`.
 */
function getVisibleFormError(): HTMLElement {
  const alerts = screen.getAllByRole('alert');
  const paragraph = alerts.find((node) => node.tagName === 'P') as
    | HTMLElement
    | undefined;
  if (!paragraph) {
    throw new Error('Visible form error paragraph not found');
  }
  return paragraph;
}

async function submitCredentials() {
  fireEvent.change(screen.getByLabelText(/^Email$/i), {
    target: { value: 'doc@example.com' },
  });
  fireEvent.change(screen.getByLabelText(/^Password$/i), {
    target: { value: 'password123' },
  });
  fireEvent.click(screen.getByRole('button', { name: /^Sign in$/i }));
}

const prevLoginPageMfaDeviceTrustEnv =
  process.env['NEXT_PUBLIC_PRACTITIONER_MFA_DEVICE_TRUST'];

describe('LoginPage MFA state machine', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeAll(() => {
    process.env['NEXT_PUBLIC_PRACTITIONER_MFA_DEVICE_TRUST'] = 'true';
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
    if (prevLoginPageMfaDeviceTrustEnv === undefined) {
      delete process.env['NEXT_PUBLIC_PRACTITIONER_MFA_DEVICE_TRUST'];
    } else {
      process.env['NEXT_PUBLIC_PRACTITIONER_MFA_DEVICE_TRUST'] =
        prevLoginPageMfaDeviceTrustEnv;
    }
  });

  beforeEach(() => {
    mockPush.mockClear();
    mockRefresh.mockClear();
    mockedTryRestore.mockReset();
    mockedTryRestore.mockResolvedValue({ status: 'not_restored' });
    mockedSaveBundle.mockClear();
    mockedClearBundle.mockClear();
    mockedTrustedUntil.mockClear();
    mockedTrustedUntil.mockReturnValue(Date.now() + 86_400_000);
    mockedRefreshBeforePassword.mockReset();
    mockedRefreshBeforePassword.mockResolvedValue(false);
    mockedReadBundle.mockReset();
    mockedReadBundle.mockReturnValue(null);
  });

  it('shows message and stays on credentials when trust restore ends session (signed_out)', async () => {
    mockedTryRestore.mockResolvedValue({ status: 'signed_out' });
    const { client } = createLoginSupabaseMock({
      assuranceFirst: { currentLevel: 'aal1', nextLevel: 'aal2' },
    });
    mockedGetClient.mockReturnValue(client as never);

    renderLogin();
    await submitCredentials();

    await waitFor(() => {
      expect(getVisibleFormError().textContent).toContain(
        'Your sign-in session ended during the saved device check',
      );
    });
    expect(screen.queryByLabelText(/Authenticator code/i)).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
    expect(client.auth.getSession).not.toHaveBeenCalled();
  });

  it('navigates to /patients when trusted MFA session restores', async () => {
    mockedTryRestore.mockResolvedValue({ status: 'restored' });
    const { client } = createLoginSupabaseMock({
      assuranceFirst: { currentLevel: 'aal1', nextLevel: 'aal2' },
    });
    mockedGetClient.mockReturnValue(client as never);

    renderLogin();
    await submitCredentials();

    await waitFor(() => {
      expect(mockedTryRestore).toHaveBeenCalledWith(expect.anything(), USER_ID);
      expect(mockPush).toHaveBeenCalledWith('/patients');
    });
    expect(screen.queryByLabelText(/Authenticator code/i)).toBeNull();
  });

  it('navigates to /patients when bundle was primed and assurance is AAL2 after password', async () => {
    mockedRefreshBeforePassword.mockResolvedValue(true);
    const trustedUntil = Date.now() + 86_400_000;
    mockedReadBundle.mockReturnValue({
      userId: USER_ID,
      email: 'doc@example.com',
      refresh_token: 'r',
      access_token: 'a',
      trustedUntilMs: trustedUntil,
    });
    const aal2AccessToken = makeUnsignedJwtForTest({
      aal: 'aal2',
      sub: USER_ID,
    });
    const { client } = createLoginSupabaseMock({
      assuranceFirst: { currentLevel: 'aal2', nextLevel: 'aal2' },
      sessionAccessToken: aal2AccessToken,
    });
    mockedGetClient.mockReturnValue(client as never);

    renderLogin();
    await submitCredentials();

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/patients');
    });
    expect(client.auth.mfa.getAuthenticatorAssuranceLevel).toHaveBeenCalled();
    expect(mockedTryRestore).not.toHaveBeenCalled();
    expect(client.auth.mfa.listFactors).not.toHaveBeenCalled();
    expect(mockedSaveBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        user: { id: USER_ID },
        refresh_token: 'refresh-token',
        access_token: aal2AccessToken,
      }),
      trustedUntil,
    );
    expect(screen.queryByLabelText(/Authenticator code/i)).toBeNull();
  });

  it('navigates to /patients when session is already AAL2', async () => {
    const { client } = createLoginSupabaseMock({
      assuranceFirst: { currentLevel: 'aal2', nextLevel: 'aal2' },
    });
    // Only one assurance read — override chain to single resolution
    (
      client.auth.mfa as { getAuthenticatorAssuranceLevel: jest.Mock }
    ).getAuthenticatorAssuranceLevel.mockReset();
    (
      client.auth.mfa as { getAuthenticatorAssuranceLevel: jest.Mock }
    ).getAuthenticatorAssuranceLevel.mockResolvedValue({
      error: null,
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
    });

    mockedGetClient.mockReturnValue(client as never);

    renderLogin();
    await submitCredentials();

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/patients');
    });
    expect(screen.queryByLabelText(/Authenticator code/i)).toBeNull();
  });

  it('redirects to practitioner home when there is no verified TOTP factor', async () => {
    const { client } = createLoginSupabaseMock({
      listFactors: { error: null, totp: [] },
    });
    mockedGetClient.mockReturnValue(client as never);

    renderLogin();
    await submitCredentials();

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
    expect(mockedClearBundle).toHaveBeenCalled();
  });

  it('credentials → MFA verify → /patients and saves trust bundle when remember device is checked', async () => {
    const { client, mfa } = createLoginSupabaseMock();
    mockedGetClient.mockReturnValue(client as never);

    renderLogin();
    await submitCredentials();

    await waitFor(() => {
      expect(screen.getByLabelText(/Authenticator code/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText(/Trust this device for 30 days/i));
    fireEvent.change(screen.getByLabelText(/Authenticator code/i), {
      target: { value: '123456' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Verify and continue/i }),
    );

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/patients');
    });

    expect(mfa.challenge).toHaveBeenCalledWith({ factorId: FACTOR_ID });
    expect(mfa.verify).toHaveBeenCalledWith({
      factorId: FACTOR_ID,
      challengeId: 'challenge-id',
      code: '123456',
    });
    expect(mockedSaveBundle).toHaveBeenCalled();
    expect(mockedClearBundle).not.toHaveBeenCalled();
  });

  it('credentials → MFA verify challenges the selected factor when multiple verified TOTP factors exist', async () => {
    const { client, mfa } = createLoginSupabaseMock({
      listFactors: {
        error: null,
        totp: [
          { id: FACTOR_ID, status: 'verified', friendly_name: 'Work phone' },
          { id: FACTOR_ID_2, status: 'verified', friendly_name: 'Personal' },
        ],
      },
    });
    mockedGetClient.mockReturnValue(client as never);

    renderLogin();
    await submitCredentials();

    await waitFor(() => {
      expect(
        screen.getByRole('combobox', { name: /^Authenticator$/i }),
      ).toBeTruthy();
    });

    fireEvent.change(
      screen.getByRole('combobox', { name: /^Authenticator$/i }),
      {
        target: { value: FACTOR_ID_2 },
      },
    );
    fireEvent.change(screen.getByLabelText(/Authenticator code/i), {
      target: { value: '123456' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Verify and continue/i }),
    );

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/patients');
    });

    expect(mfa.challenge).toHaveBeenCalledWith({ factorId: FACTOR_ID_2 });
    expect(mfa.verify).toHaveBeenCalledWith({
      factorId: FACTOR_ID_2,
      challengeId: 'challenge-id',
      code: '123456',
    });
  });

  it('clears trust bundle on successful verify when remember device is unchecked', async () => {
    const { client } = createLoginSupabaseMock();
    mockedGetClient.mockReturnValue(client as never);

    renderLogin();
    await submitCredentials();

    await waitFor(() => {
      expect(screen.getByLabelText(/Authenticator code/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(/Authenticator code/i), {
      target: { value: '654321' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Verify and continue/i }),
    );

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/patients');
    });

    expect(mockedClearBundle).toHaveBeenCalled();
    expect(mockedSaveBundle).not.toHaveBeenCalled();
  });

  it('does not navigate when getSession fails after MFA verify', async () => {
    const { client } = createLoginSupabaseMock({
      mfaVerifyGetSession: {
        error: { message: 'session read failed' },
        session: null,
      },
    });
    mockedGetClient.mockReturnValue(client as never);

    renderLogin();
    await submitCredentials();

    await waitFor(() => {
      expect(screen.getByLabelText(/Authenticator code/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(/Authenticator code/i), {
      target: { value: '123456' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Verify and continue/i }),
    );

    await waitFor(() => {
      expect(getVisibleFormError().textContent).toContain(
        'Could not read your session after verification',
      );
    });
    expect(mockPush).not.toHaveBeenCalledWith('/patients');
  });

  it('does not navigate when getSession returns no session after MFA verify', async () => {
    const { client } = createLoginSupabaseMock({
      mfaVerifyGetSession: {
        error: null,
        session: null,
      },
    });
    mockedGetClient.mockReturnValue(client as never);

    renderLogin();
    await submitCredentials();

    await waitFor(() => {
      expect(screen.getByLabelText(/Authenticator code/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(/Authenticator code/i), {
      target: { value: '654321' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Verify and continue/i }),
    );

    await waitFor(() => {
      expect(getVisibleFormError().textContent).toContain(
        'could not be confirmed after verification',
      );
    });
    expect(mockPush).not.toHaveBeenCalledWith('/patients');
  });

  it('returns to credentials when getSession fails after trust restore returns false', async () => {
    const { client } = createLoginSupabaseMock({
      assuranceFirst: { currentLevel: 'aal1', nextLevel: 'aal2' },
    });
    (client.auth.getSession as jest.Mock).mockResolvedValueOnce({
      error: { message: 'storage read failed' },
      data: { session: null },
    });
    mockedGetClient.mockReturnValue(client as never);

    renderLogin();
    await submitCredentials();

    await waitFor(() => {
      expect(getVisibleFormError().textContent).toContain(
        'Could not confirm your session after the saved device check',
      );
    });
    expect(screen.queryByLabelText(/Authenticator code/i)).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('returns to credentials when getSession returns no session after trust restore returns false', async () => {
    const { client } = createLoginSupabaseMock({
      assuranceFirst: { currentLevel: 'aal1', nextLevel: 'aal2' },
    });
    (client.auth.getSession as jest.Mock).mockResolvedValueOnce({
      error: null,
      data: { session: null },
    });
    mockedGetClient.mockReturnValue(client as never);

    renderLogin();
    await submitCredentials();

    await waitFor(() => {
      expect(getVisibleFormError().textContent).toContain(
        'Your sign-in session ended during the saved device check',
      );
    });
    expect(screen.queryByLabelText(/Authenticator code/i)).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('returns to credentials when session user id differs after trust restore returns false', async () => {
    const { client } = createLoginSupabaseMock({
      assuranceFirst: { currentLevel: 'aal1', nextLevel: 'aal2' },
    });
    (client.auth.getSession as jest.Mock).mockResolvedValueOnce({
      error: null,
      data: {
        session: {
          user: { id: '99999999-9999-9999-9999-999999999999' },
          refresh_token: 'refresh-token',
          access_token: 'access-token',
        },
      },
    });
    mockedGetClient.mockReturnValue(client as never);

    renderLogin();
    await submitCredentials();

    await waitFor(() => {
      expect(getVisibleFormError().textContent).toContain(
        'no longer matches this sign-in after the saved device check',
      );
    });
    expect(getVisibleFormError().textContent).toContain(
      'signed out for safety',
    );
    expect(client.auth.signOut).toHaveBeenCalled();
    expect(mockedClearBundle).toHaveBeenCalled();
    expect(screen.queryByLabelText(/Authenticator code/i)).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows auth error when password sign-in fails', async () => {
    const { client } = createLoginSupabaseMock({
      signInError: { message: 'Invalid login credentials' },
    });
    mockedGetClient.mockReturnValue(client as never);

    renderLogin();
    await submitCredentials();

    await waitFor(() => {
      expect(getVisibleFormError().textContent).toContain(
        'Invalid login credentials',
      );
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('signs out and clears trust bundle when getUser does not resolve after password sign-in', async () => {
    const { client, mfa } = createLoginSupabaseMock({
      getUserResponse: { error: null, user: null },
    });
    mockedGetClient.mockReturnValue(client as never);

    renderLogin();
    await submitCredentials();

    await waitFor(() => {
      expect(getVisibleFormError().textContent).toContain(
        'Could not resolve your account after sign-in.',
      );
    });

    expect(mfa.signOut).toHaveBeenCalled();
    expect(mockedClearBundle).toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
    expect(mfa.listFactors).not.toHaveBeenCalled();
  });

  it('signs out and clears trust bundle when MFA setup fails after password succeeds', async () => {
    const { client, mfa } = createLoginSupabaseMock({
      listFactors: { error: new Error('network'), totp: [] },
    });
    mockedGetClient.mockReturnValue(client as never);

    renderLogin();
    await submitCredentials();

    await waitFor(() => {
      expect(getVisibleFormError().textContent).toMatch(
        /signed out for safety/i,
      );
    });

    expect(mfa.signOut).toHaveBeenCalled();
    expect(mockedClearBundle).toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('does not call MFA challenge when code is not six digits', async () => {
    const { client, mfa } = createLoginSupabaseMock();
    mockedGetClient.mockReturnValue(client as never);

    renderLogin();
    await submitCredentials();

    await waitFor(() => {
      expect(screen.getByLabelText(/Authenticator code/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(/Authenticator code/i), {
      target: { value: '12345' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Verify and continue/i }),
    );

    await waitFor(() => {
      expect(getVisibleFormError().textContent).toMatch(/six-digit/i);
    });
    expect(mfa.challenge).not.toHaveBeenCalled();
  });

  it('shows error when assurance is not AAL2 after verify', async () => {
    const { client } = createLoginSupabaseMock({
      assuranceAfterVerify: { currentLevel: 'aal1', nextLevel: 'aal2' },
    });
    mockedGetClient.mockReturnValue(client as never);

    renderLogin();
    await submitCredentials();

    await waitFor(() => {
      expect(screen.getByLabelText(/Authenticator code/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(/Authenticator code/i), {
      target: { value: '111111' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Verify and continue/i }),
    );

    await waitFor(() => {
      expect(getVisibleFormError().textContent).toMatch(
        /did not finish updating your session/i,
      );
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('returns to credentials after Back to sign out', async () => {
    const { client, mfa } = createLoginSupabaseMock();
    mockedGetClient.mockReturnValue(client as never);

    renderLogin();
    await submitCredentials();

    await waitFor(() => {
      expect(screen.getByLabelText(/Authenticator code/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /Back to sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Sign in$/i })).toBeTruthy();
    });

    expect(mfa.signOut).toHaveBeenCalled();
    expect(mockedClearBundle).toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
    expect(screen.queryByLabelText(/Authenticator code/i)).toBeNull();
  });
});
