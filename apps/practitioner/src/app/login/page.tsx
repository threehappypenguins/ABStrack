'use client';

import {
  hasMfaAssuranceAal2,
  parseAbstrackAccessTokenClaims,
  signInWithEmailPassword,
  type Session,
} from '@abstrack/supabase';
import { getSupabaseBrowserClient } from '@abstrack/supabase/browser';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  clearMfaTrustBundle,
  getTrustedUntilMsAfterVerification,
  isPractitionerMfaDeviceTrustEnabled,
  saveMfaTrustBundle,
  tryRestoreTrustedMfaSession,
} from '../../lib/practitioner-device-trust';
import {
  looksLikeTotpSetupPayload,
  mapMfaVerifyErrorToUserMessage,
  normalizeTotpCode,
} from '../../lib/mfa-user-messages';

type LoginStep = 'credentials' | 'mfa_verify';

/** Verified TOTP row from `auth.mfa.listFactors()` — `friendly_name` is optional in API payloads. */
type ListedTotpFactor = {
  id: string;
  friendly_name?: string | null;
};

/**
 * Builds stable labels for the MFA factor picker when multiple verified TOTP factors exist.
 *
 * @param factors - Verified TOTP factors for the current user.
 * @returns `{ id, label }` entries for each factor.
 */
function buildMfaFactorChoices(factors: ListedTotpFactor[]): Array<{
  id: string;
  label: string;
}> {
  return factors.map((f, index) => ({
    id: f.id,
    label:
      typeof f.friendly_name === 'string' && f.friendly_name.trim() !== ''
        ? f.friendly_name.trim()
        : `Authenticator ${index + 1}`,
  }));
}

/** Max polls when waiting for the access token JWT to include `aal: aal2` after assurance reports AAL2. */
const JWT_AAL2_SYNC_MAX_ATTEMPTS = 8;
const JWT_AAL2_SYNC_DELAY_MS = 75;

/**
 * Patient routes gate on JWT `aal` via `hasMfaAssuranceAal2` (see `resolvePractitionerAppGate` in
 * `@abstrack/supabase`). After MFA or trust restore, `getAuthenticatorAssuranceLevel` can
 * report AAL2 before Supabase refreshes the session JWT — briefly polls `getSession()` so we do
 * not navigate to `/patients` while the gate would still see `aal1`.
 *
 * When `sessionHint` is set (e.g. the `getSession()` result right after `mfa.verify`), parses that
 * token first so a token already showing `aal: aal2` avoids an extra round-trip and matches what
 * the practitioner gate reads from the client session.
 *
 * @param supabase - Browser Supabase client.
 * @param sessionHint - Optional session to parse before polling (same shape as `getSession().data.session`).
 * @returns The session whose `access_token` parses to AAL2, or `null` if still stale / missing.
 */
async function waitForSessionWithJwtAal2(
  supabase: ReturnType<typeof getSupabaseBrowserClient>,
  sessionHint?: Session | null,
): Promise<Session | null> {
  if (sessionHint?.access_token != null) {
    const hintClaims = parseAbstrackAccessTokenClaims(sessionHint.access_token);
    if (hasMfaAssuranceAal2(hintClaims)) {
      return sessionHint;
    }
  }
  for (let attempt = 0; attempt < JWT_AAL2_SYNC_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, JWT_AAL2_SYNC_DELAY_MS),
      );
    }
    const { data, error } = await supabase.auth.getSession();
    if (error || data.session?.access_token == null) {
      return null;
    }
    const claims = parseAbstrackAccessTokenClaims(data.session.access_token);
    if (hasMfaAssuranceAal2(claims)) {
      return data.session;
    }
  }
  return null;
}

/**
 * Practitioner email/password login with MFA step-up and optional device trust (browser storage).
 * Successful verification with “Trust this device” unchecked clears any stored bundle so trust
 * matches the checkbox for this sign-in. If there is no verified TOTP factor, any existing bundle
 * is cleared before redirecting to practitioner home for TOTP enrollment so stale tokens are not kept in storage.
 * After email/password authentication succeeds, password state is cleared immediately so the secret
 * is not retained through MFA or device-trust checks.
 * If `getUser` does not return a user id after a successful password sign-in, the client signs out
 * and clears the trust bundle so no half-established session remains. After
 * {@link tryRestoreTrustedMfaSession} (discriminated: `restored`, `not_restored`, or `signed_out`;
 * some outcomes sign the user out), the client re-checks `getSession` when the outcome is
 * `not_restored` before reading assurance or showing the MFA step so a missing session cannot be
 * mistaken for a password session still awaiting TOTP. If the post-restore session user id does not
 * match the account from password sign-in, the client signs out and clears the trust bundle before
 * prompting for credentials again.
 *
 * The credentials form ignores duplicate submits while a sign-in is already in progress (see
 * `loading`, `step`, and `credentialLoginInFlightRef`) so parallel attempts cannot race. The MFA
 * verify form uses the same pattern (`verifyLoading`, `step`, `verifyMfaInFlightRef`).
 *
 * MFA “trust this device” is hidden when `isPractitionerMfaDeviceTrustEnabled()` is false; see
 * that function for `NEXT_PUBLIC_PRACTITIONER_MFA_DEVICE_TRUST` parsing (unset defaults on;
 * unrecognized non-empty values disable).
 *
 * `resetToCredentials` centralizes fallback to the credentials step: it clears MFA-only UI
 * state (code, trust checkbox, status line) so a later MFA step is not prefilled from a prior
 * attempt, optionally sets assertive error copy, and can clear the password after session-ending
 * failures so secrets are not left in memory.
 *
 * When several verified TOTP factors exist, the MFA step shows an **Authenticator** combobox
 * (friendly name or “Authenticator N”) so challenge/verify use the factor the user selects.
 *
 * Before navigating to `/patients`, the client waits until the session access token’s JWT `aal`
 * claim matches patient-route gating (not only `getAuthenticatorAssuranceLevel`).
 *
 * **Device trust:** the client does not call `refreshSession` from the stored bundle until after
 * `signInWithEmailPassword` succeeds, so no authenticated session is persisted from the trust bundle
 * before the password is verified.
 *
 * @returns Login UI.
 */
export default function LoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const deviceTrustFeatureEnabled = useMemo(
    () => isPractitionerMfaDeviceTrustEnabled(),
    [],
  );
  const { announce } = useAnnounce();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [rememberDevice, setRememberDevice] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  /** Populated when entering MFA verify so multiple enrolled TOTP factors can be chosen by label. */
  const [mfaFactorChoices, setMfaFactorChoices] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [step, setStep] = useState<LoginStep>('credentials');
  const [loading, setLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [backToSignInLoading, setBackToSignInLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  /** Synchronous guard: `loading` can lag one frame behind rapid duplicate submits. */
  const credentialLoginInFlightRef = useRef(false);
  /** Synchronous guard: `verifyLoading` can lag behind rapid duplicate MFA submits. */
  const verifyMfaInFlightRef = useRef(false);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const mfaFactorSelectRef = useRef<HTMLSelectElement>(null);
  const mfaCodeInputRef = useRef<HTMLInputElement>(null);
  const prevStepRef = useRef<LoginStep>(step);

  /**
   * When device trust is disabled (`NEXT_PUBLIC_PRACTITIONER_MFA_DEVICE_TRUST`), clears
   * remember-device state so it cannot remain true while the trust UI is hidden.
   */
  useEffect(() => {
    if (!deviceTrustFeatureEnabled) {
      setRememberDevice(false);
    }
  }, [deviceTrustFeatureEnabled]);

  /**
   * Moves focus when the visible step changes so keyboard and screen-reader users are not left on
   * an unmounted control (e.g. Sign in) after switching to MFA, and land on the email field when
   * returning from MFA.
   */
  useEffect(() => {
    const previousStep = prevStepRef.current;
    prevStepRef.current = step;

    if (step === 'mfa_verify' && previousStep !== 'mfa_verify') {
      const frameId = requestAnimationFrame(() => {
        if (mfaFactorChoices.length > 1) {
          mfaFactorSelectRef.current?.focus();
        } else {
          mfaCodeInputRef.current?.focus();
        }
      });
      return () => cancelAnimationFrame(frameId);
    }

    if (step === 'credentials' && previousStep === 'mfa_verify') {
      const frameId = requestAnimationFrame(() => {
        emailInputRef.current?.focus();
      });
      return () => cancelAnimationFrame(frameId);
    }

    return undefined;
  }, [step, mfaFactorChoices.length]);

  /**
   * Returns the UI to the credentials step and clears MFA-only state so later flows are not
   * prefilled from a prior attempt. Optionally sets an assertive error line and matching live
   * announcement, and clears the password after abandoned or session-ending sign-in.
   *
   * @param options.message - When set, passed to `setError` and `announce` (assertive).
   * @param options.clearPassword - Clears the password field when true.
   */
  const resetToCredentials = useCallback(
    (options?: { clearPassword?: boolean; message?: string }) => {
      setStep('credentials');
      setVerifyCode('');
      setRememberDevice(false);
      setMfaFactorId(null);
      setMfaFactorChoices([]);
      setStatus(null);
      if (options?.clearPassword) {
        setPassword('');
      }
      if (options?.message != null) {
        setError(options.message);
        announce(options.message, { politeness: 'assertive' });
      }
    },
    [announce],
  );

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      step !== 'credentials' ||
      loading ||
      credentialLoginInFlightRef.current
    ) {
      return;
    }
    credentialLoginInFlightRef.current = true;
    setError(null);
    setStatus(null);
    setLoading(true);

    /** True once password sign-in resolved a user; MFA/trust steps may still fail afterward. */
    let sessionEstablishedAfterPassword = false;

    try {
      const { error: authError } = await signInWithEmailPassword(
        supabase,
        email,
        password,
      );

      if (authError) {
        resetToCredentials({ message: authError.message });
        return;
      }

      // Drop the password from state as soon as Supabase accepted it so it is not retained through
      // MFA / trust checks (controlled input clears with state).
      setPassword('');

      const userResult = await supabase.auth.getUser();
      const user = userResult.data.user;
      if (userResult.error || user?.id == null || user.id === '') {
        try {
          await supabase.auth.signOut();
          clearMfaTrustBundle();
        } catch (cleanupError) {
          console.error(cleanupError);
        }
        router.refresh();
        resetToCredentials({
          message: 'Could not resolve your account after sign-in.',
        });
        return;
      }

      sessionEstablishedAfterPassword = true;

      // Password-only sign-in is usually AAL1; patient routes require JWT `aal` aal2. Device-trust
      // restore runs only after the password grant via `tryRestoreTrustedMfaSession` — we do not
      // call `refreshSession` from the bundle before password (that would persist an authenticated
      // session before the password is verified).

      const factorsResult = await supabase.auth.mfa.listFactors();
      if (factorsResult.error) {
        throw factorsResult.error;
      }

      const verifiedTotpFactors = factorsResult.data.totp.filter(
        (factor) => factor.status === 'verified',
      );
      if (verifiedTotpFactors.length < 1) {
        clearMfaTrustBundle();
        const message =
          'No verified TOTP factor yet. Redirecting so you can enroll an authenticator.';
        announce(message, { politeness: 'assertive' });
        router.push('/');
        router.refresh();
        return;
      }

      const restoreOutcome = await tryRestoreTrustedMfaSession(
        supabase,
        user.id,
      );
      if (restoreOutcome.status === 'restored') {
        const sessionWithJwtAal2 = await waitForSessionWithJwtAal2(supabase);
        if (sessionWithJwtAal2 != null) {
          router.push('/patients');
          router.refresh();
          return;
        }
        /* Else: JWT `aal` may still lag; fall through to session/assurance checks. */
      }
      if (restoreOutcome.status === 'signed_out') {
        router.refresh();
        resetToCredentials({
          clearPassword: true,
          message:
            'Your sign-in session ended during the saved device check. Enter your email and password again.',
        });
        return;
      }

      const afterRestoreSession = await supabase.auth.getSession();
      if (afterRestoreSession.error) {
        console.error(afterRestoreSession.error);
        resetToCredentials({
          clearPassword: true,
          message:
            'Could not confirm your session after the saved device check. Enter your email and password again.',
        });
        return;
      }
      if (afterRestoreSession.data.session?.user?.id == null) {
        resetToCredentials({
          clearPassword: true,
          message:
            'Your sign-in session ended during the saved device check. Enter your email and password again.',
        });
        return;
      }
      if (afterRestoreSession.data.session.user.id !== user.id) {
        try {
          await supabase.auth.signOut();
          clearMfaTrustBundle();
        } catch (cleanupError) {
          console.error(cleanupError);
        }
        router.refresh();
        resetToCredentials({
          clearPassword: true,
          message:
            'Your session no longer matches this sign-in after the saved device check. You have been signed out for safety. Enter your email and password again.',
        });
        return;
      }

      const assurance =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error) {
        throw assurance.error;
      }

      if (assurance.data.currentLevel === 'aal2') {
        const sessionWithJwtAal2 = await waitForSessionWithJwtAal2(supabase);
        if (sessionWithJwtAal2 != null) {
          router.push('/patients');
          router.refresh();
          return;
        }
        /* Fall through to MFA step when JWT `aal` still reflects AAL1. */
      }

      setMfaFactorChoices(
        buildMfaFactorChoices(verifiedTotpFactors as ListedTotpFactor[]),
      );
      setMfaFactorId(verifiedTotpFactors[0]?.id ?? null);
      setStep('mfa_verify');
      const message =
        verifiedTotpFactors.length > 1
          ? 'Choose which authenticator to use, then enter the six-digit code.'
          : 'Enter the six-digit code from your authenticator app to continue.';
      setStatus(message);
      announce(message, { politeness: 'assertive' });
    } catch (nextError) {
      console.error(nextError);
      if (sessionEstablishedAfterPassword) {
        try {
          await supabase.auth.signOut();
          clearMfaTrustBundle();
        } catch (cleanupError) {
          console.error(cleanupError);
        }
        router.refresh();
        resetToCredentials({
          clearPassword: true,
          message:
            'Your password was accepted, but we could not finish verifying multi-factor sign-in. You have been signed out for safety. Please try again.',
        });
      } else {
        resetToCredentials({
          message: 'Unable to complete sign-in right now. Please try again.',
        });
      }
    } finally {
      credentialLoginInFlightRef.current = false;
      setLoading(false);
    }
  };

  const handleVerifyMfa = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      step !== 'mfa_verify' ||
      verifyLoading ||
      verifyMfaInFlightRef.current
    ) {
      return;
    }
    verifyMfaInFlightRef.current = true;
    try {
      setError(null);
      setStatus(null);

      if (mfaFactorId == null) {
        const message =
          'Could not determine which authenticator to verify. Please sign in again.';
        setError(message);
        announce(message, { politeness: 'assertive' });
        return;
      }

      if (!/^\d{6}$/.test(verifyCode)) {
        const message =
          'Enter the current six-digit code from your authenticator app.';
        setError(message);
        announce(message, { politeness: 'assertive' });
        return;
      }

      setVerifyLoading(true);
      try {
        const challenge = await supabase.auth.mfa.challenge({
          factorId: mfaFactorId,
        });
        if (challenge.error) {
          throw challenge.error;
        }

        const verify = await supabase.auth.mfa.verify({
          factorId: mfaFactorId,
          challengeId: challenge.data.id,
          code: verifyCode,
        });
        if (verify.error) {
          throw verify.error;
        }

        const { data: sessionAfterVerify, error: sessionAfterVerifyError } =
          await supabase.auth.getSession();
        if (sessionAfterVerifyError) {
          console.error(sessionAfterVerifyError);
          const message =
            'Could not read your session after verification. Try a new code from your authenticator app, or use Back to sign in to start over.';
          setError(message);
          announce(message, { politeness: 'assertive' });
          return;
        }
        if (sessionAfterVerify.session == null) {
          const message =
            'Your session could not be confirmed after verification. Try a new code from your authenticator app, or use Back to sign in to start over.';
          setError(message);
          announce(message, { politeness: 'assertive' });
          return;
        }

        const assuranceAfterVerify =
          await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (assuranceAfterVerify.error) {
          console.error(assuranceAfterVerify.error);
          const message =
            'Could not confirm multi-factor status after verification. Try a new code from your authenticator app, or use Back to sign in to start over.';
          setError(message);
          announce(message, { politeness: 'assertive' });
          return;
        }
        if (assuranceAfterVerify.data.currentLevel !== 'aal2') {
          const message =
            'Multi-factor sign-in did not finish updating your session. Try another code, or use Back to sign in to start over.';
          setError(message);
          announce(message, { politeness: 'assertive' });
          return;
        }

        const sessionWithJwtAal2 = await waitForSessionWithJwtAal2(
          supabase,
          sessionAfterVerify.session,
        );
        if (sessionWithJwtAal2 == null) {
          const message =
            'Your session did not show full two-factor verification yet. Try another code, or use Back to sign in to start over.';
          setError(message);
          announce(message, { politeness: 'assertive' });
          return;
        }

        if (deviceTrustFeatureEnabled && rememberDevice) {
          saveMfaTrustBundle(
            sessionWithJwtAal2,
            getTrustedUntilMsAfterVerification(),
          );
        } else {
          clearMfaTrustBundle();
        }

        router.push('/patients');
        router.refresh();
      } catch (verifyError) {
        const message = mapMfaVerifyErrorToUserMessage(verifyError);
        setError(message);
        announce(message, { politeness: 'assertive' });
      } finally {
        setVerifyLoading(false);
      }
    } finally {
      verifyMfaInFlightRef.current = false;
    }
  };

  const handleBackToSignIn = async () => {
    if (verifyLoading || backToSignInLoading) {
      return;
    }
    setError(null);
    setBackToSignInLoading(true);
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        throw signOutError;
      }
      clearMfaTrustBundle();
      resetToCredentials({ clearPassword: true });
      router.refresh();
      announce(
        'Signed out. You can enter your email and password to sign in again.',
        { politeness: 'polite' },
      );
    } catch (backError) {
      console.error(backError);
      const message =
        'Could not sign out. Try again, or refresh the page before using a different account.';
      setError(message);
      announce(message, { politeness: 'assertive' });
    } finally {
      setBackToSignInLoading(false);
    }
  };

  const showCredentialsStep = step === 'credentials';

  return (
    <main
      id="main-content"
      className="flex min-h-screen items-center justify-center bg-app-bg bg-app-gradient px-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-app-border/90 bg-app-surface p-8 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
        <h1 className="mb-2 text-center text-2xl font-bold text-app-ink">
          Practitioner login
        </h1>
        <p className="text-center text-sm text-app-muted">
          Sign in with your practitioner account.
        </p>

        {status ? (
          <p
            role="status"
            aria-live="polite"
            className="mt-4 rounded border border-app-border bg-app-bg p-3 text-sm text-app-muted"
          >
            {status}
          </p>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800/60 dark:bg-red-950/35 dark:text-red-200"
          >
            {error}
          </p>
        ) : null}

        {showCredentialsStep ? (
          <form onSubmit={handleLogin} className="mt-5 space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-app-muted"
              >
                Email
              </label>
              <input
                ref={emailInputRef}
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 block w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-app-ink shadow-sm focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-ring"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-app-muted"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 block w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-app-ink shadow-sm focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-ring"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-app-primary px-4 py-2 text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyMfa} className="mt-5 space-y-4">
            {mfaFactorChoices.length > 1 ? (
              <div>
                <label
                  htmlFor="mfa-factor"
                  className="block text-sm font-medium text-app-muted"
                >
                  Authenticator
                </label>
                <select
                  ref={mfaFactorSelectRef}
                  id="mfa-factor"
                  name="mfa-factor"
                  aria-describedby="mfa-factor-hint"
                  value={mfaFactorId ?? ''}
                  onChange={(event) => {
                    setMfaFactorId(event.target.value || null);
                    setError(null);
                  }}
                  className="mt-1 block w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-app-ink shadow-sm focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-ring"
                >
                  {mfaFactorChoices.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.label}
                    </option>
                  ))}
                </select>
                <p id="mfa-factor-hint" className="mt-1 text-xs text-app-muted">
                  Use the code from the app you named here.
                </p>
              </div>
            ) : null}
            <div>
              <label
                htmlFor="mfa-code"
                className="block text-sm font-medium text-app-muted"
              >
                Authenticator code
              </label>
              <input
                ref={mfaCodeInputRef}
                id="mfa-code"
                name="mfa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={verifyCode}
                onChange={(event) => {
                  const raw = event.target.value;
                  if (looksLikeTotpSetupPayload(raw)) {
                    const message =
                      'Enter only the six-digit code from your authenticator app.';
                    setVerifyCode('');
                    setError(message);
                    announce(message, { politeness: 'assertive' });
                    return;
                  }
                  setError(null);
                  setVerifyCode(normalizeTotpCode(raw));
                }}
                className="mt-1 block w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-app-ink shadow-sm focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-ring"
                placeholder="123456"
              />
            </div>

            {deviceTrustFeatureEnabled ? (
              <label className="flex items-start gap-2 text-sm text-app-muted">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-app-border text-app-primary focus:ring-app-ring"
                  checked={rememberDevice}
                  onChange={(event) => setRememberDevice(event.target.checked)}
                />
                <span>Trust this device for 30 days.</span>
              </label>
            ) : null}

            <button
              type="submit"
              disabled={verifyLoading}
              className="w-full rounded-md bg-app-primary px-4 py-2 text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {verifyLoading ? 'Verifying code...' : 'Verify and continue'}
            </button>

            <button
              type="button"
              disabled={verifyLoading || backToSignInLoading}
              {...(backToSignInLoading ? { 'aria-busy': true as const } : {})}
              aria-describedby="login-back-to-sign-in-hint"
              onClick={() => {
                void handleBackToSignIn();
              }}
              className="w-full rounded-md border border-app-border bg-app-surface px-4 py-2 text-app-ink transition hover:bg-[var(--app-nav-hover-bg)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {backToSignInLoading ? 'Signing out…' : 'Back to sign in'}
            </button>
            <p
              id="login-back-to-sign-in-hint"
              className="text-center text-xs text-app-muted"
            >
              Ends this session so you can use a different account or start
              over.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
