'use client';

import { signInWithEmailPassword } from '@abstrack/supabase';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  looksLikeTotpSetupPayload,
  mapMfaVerifyErrorToUserMessage,
  normalizeTotpCode,
} from '@/lib/mfa-user-messages';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import {
  clearMfaTrustBundle,
  getTrustedUntilMsForDuration,
  isUserMfaDeviceTrustEnabled,
  saveMfaTrustBundle,
  tryRestoreTrustedMfaSession,
  type UserMfaDeviceTrustDuration,
} from '@/lib/user-mfa-device-trust';

/** Whether to skip TOTP on later sign-ins from this browser, and for how long. */
type DeviceTrustChoice = 'none' | UserMfaDeviceTrustDuration;

type LoginStep = 'credentials' | 'mfa_verify';

type ListedTotpFactor = {
  id: string;
  friendly_name?: string | null;
};

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

/**
 * Patient/caretaker email/password login with optional TOTP step-up and device trust (30 days or 1 year).
 *
 * @returns Login form (credentials and MFA verify steps).
 */
export function UserLoginForm() {
  const formId = useId();
  const router = useRouter();
  const { announce } = useAnnounce();
  const supabase = useMemo(() => createBrowserClient(), []);
  const deviceTrustFeatureEnabled = useMemo(
    () => isUserMfaDeviceTrustEnabled(),
    [],
  );

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [deviceTrustChoice, setDeviceTrustChoice] =
    useState<DeviceTrustChoice>('none');
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaFactorChoices, setMfaFactorChoices] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [step, setStep] = useState<LoginStep>('credentials');
  const [loading, setLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [backToSignInLoading, setBackToSignInLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const credentialLoginInFlightRef = useRef(false);
  const verifyMfaInFlightRef = useRef(false);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const mfaFactorSelectRef = useRef<HTMLSelectElement>(null);
  const mfaCodeInputRef = useRef<HTMLInputElement>(null);
  const prevStepRef = useRef<LoginStep>(step);

  useEffect(() => {
    if (!deviceTrustFeatureEnabled) {
      setDeviceTrustChoice('none');
    }
  }, [deviceTrustFeatureEnabled]);

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

  const resetToCredentials = useCallback(
    (options?: { clearPassword?: boolean; message?: string }) => {
      setStep('credentials');
      setVerifyCode('');
      setDeviceTrustChoice('none');
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

  const finishLogin = useCallback(() => {
    router.push('/dashboard');
    router.refresh();
  }, [router]);

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

      const factorsResult = await supabase.auth.mfa.listFactors();
      if (factorsResult.error) {
        throw factorsResult.error;
      }

      const verifiedTotpFactors = factorsResult.data.totp.filter(
        (factor) => factor.status === 'verified',
      );

      if (verifiedTotpFactors.length < 1) {
        clearMfaTrustBundle();
        finishLogin();
        return;
      }

      const restoreOutcome = await tryRestoreTrustedMfaSession(
        supabase,
        user.id,
      );
      if (restoreOutcome.status === 'restored') {
        finishLogin();
        return;
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

      const afterRestoreUser = await supabase.auth.getUser();
      if (afterRestoreUser.error) {
        console.error(afterRestoreUser.error);
        resetToCredentials({
          clearPassword: true,
          message:
            'Could not confirm your session after the saved device check. Enter your email and password again.',
        });
        return;
      }
      if (afterRestoreUser.data.user?.id == null) {
        resetToCredentials({
          clearPassword: true,
          message:
            'Your sign-in session ended during the saved device check. Enter your email and password again.',
        });
        return;
      }
      if (afterRestoreUser.data.user.id !== user.id) {
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
            'Your session no longer matches this sign-in. You have been signed out for safety. Enter your email and password again.',
        });
        return;
      }

      const assurance =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error) {
        throw assurance.error;
      }

      if (assurance.data.currentLevel === 'aal2') {
        finishLogin();
        return;
      }

      setMfaFactorChoices(buildMfaFactorChoices(verifiedTotpFactors));
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
            'Your password was accepted, but we could not finish verifying two-factor sign-in. You have been signed out for safety. Please try again.',
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

        const assuranceAfterVerify =
          await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (assuranceAfterVerify.error) {
          throw assuranceAfterVerify.error;
        }
        if (assuranceAfterVerify.data.currentLevel !== 'aal2') {
          const message =
            'Two-factor sign-in did not finish updating your session. Try another code, or use Back to sign in to start over.';
          setError(message);
          announce(message, { politeness: 'assertive' });
          return;
        }

        const { data: sessionAfterVerify, error: sessionAfterVerifyError } =
          await supabase.auth.getSession();
        if (sessionAfterVerifyError || sessionAfterVerify.session == null) {
          const message =
            'Your session could not be confirmed after verification. Try a new code from your authenticator app, or use Back to sign in to start over.';
          setError(message);
          announce(message, { politeness: 'assertive' });
          return;
        }

        if (deviceTrustFeatureEnabled && deviceTrustChoice !== 'none') {
          saveMfaTrustBundle(
            sessionAfterVerify.session,
            getTrustedUntilMsForDuration(deviceTrustChoice),
          );
        } else {
          clearMfaTrustBundle();
        }

        finishLogin();
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
    <>
      {status ? (
        <p
          role="status"
          className="mb-4 rounded border border-app-border bg-app-bg p-3 text-sm text-app-muted"
        >
          {status}
        </p>
      ) : null}

      {error ? (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800/60 dark:bg-red-950/35 dark:text-red-200">
          {error}
        </div>
      ) : null}

      {showCredentialsStep ? (
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label
              htmlFor={`${formId}-email`}
              className="block text-sm font-medium text-app-muted"
            >
              Email
            </label>
            <input
              ref={emailInputRef}
              id={`${formId}-email`}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="mt-1 block w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-app-ink shadow-sm focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-ring"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label
              htmlFor={`${formId}-password`}
              className="block text-sm font-medium text-app-muted"
            >
              Password
            </label>
            <input
              id={`${formId}-password`}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="mt-1 block w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-app-ink shadow-sm focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-ring"
              placeholder="••••••••"
            />
            <div className="mt-2 text-right">
              <Link
                href="/forgot-password"
                className="text-sm text-app-primary hover:underline"
              >
                Forgot password?
              </Link>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-app-primary-solid px-4 py-2 text-app-on-primary-solid transition hover:brightness-105 disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyMfa} className="space-y-4">
          {mfaFactorChoices.length > 1 ? (
            <div>
              <label
                htmlFor={`${formId}-mfa-factor`}
                className="block text-sm font-medium text-app-muted"
              >
                Authenticator
              </label>
              <select
                ref={mfaFactorSelectRef}
                id={`${formId}-mfa-factor`}
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
            </div>
          ) : null}
          <div>
            <label
              htmlFor={`${formId}-mfa-code`}
              className="block text-sm font-medium text-app-muted"
            >
              Authenticator code
            </label>
            <input
              ref={mfaCodeInputRef}
              id={`${formId}-mfa-code`}
              inputMode="numeric"
              autoComplete="one-time-code"
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
            <fieldset className="space-y-2 rounded-md border border-app-border/80 p-3">
              <legend className="px-1 text-sm font-medium text-app-ink">
                Remember this device
              </legend>
              <p className="text-xs text-app-muted">
                Skip the authenticator code on later sign-ins from this browser.
                Sign out everywhere in Settings to require a code again sooner.
              </p>
              <div className="space-y-2 text-sm text-app-muted">
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name={`${formId}-device-trust`}
                    className="mt-1 h-4 w-4 border-app-border"
                    checked={deviceTrustChoice === 'none'}
                    onChange={() => setDeviceTrustChoice('none')}
                  />
                  <span>Ask every time I sign in on this device</span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name={`${formId}-device-trust`}
                    className="mt-1 h-4 w-4 border-app-border"
                    checked={deviceTrustChoice === '30_days'}
                    onChange={() => setDeviceTrustChoice('30_days')}
                  />
                  <span>Do not ask again for 30 days</span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name={`${formId}-device-trust`}
                    className="mt-1 h-4 w-4 border-app-border"
                    checked={deviceTrustChoice === '1_year'}
                    onChange={() => setDeviceTrustChoice('1_year')}
                  />
                  <span>Do not ask again for 1 year</span>
                </label>
              </div>
            </fieldset>
          ) : null}

          <button
            type="submit"
            disabled={verifyLoading}
            className="w-full rounded-md bg-app-primary-solid px-4 py-2 text-app-on-primary-solid transition hover:brightness-105 disabled:opacity-50"
          >
            {verifyLoading ? 'Verifying code...' : 'Verify and continue'}
          </button>

          <button
            type="button"
            disabled={verifyLoading || backToSignInLoading}
            onClick={() => {
              void handleBackToSignIn();
            }}
            className="w-full rounded-md border border-app-border bg-app-surface px-4 py-2 text-app-ink transition hover:bg-app-bg disabled:opacity-50"
          >
            {backToSignInLoading ? 'Signing out…' : 'Back to sign in'}
          </button>
        </form>
      )}
    </>
  );
}
