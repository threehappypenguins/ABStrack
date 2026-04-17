'use client';

import { signInWithEmailPassword } from '@abstrack/supabase';
import { getSupabaseBrowserClient } from '@abstrack/supabase/browser';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import {
  getTrustedUntilMsAfterVerification,
  saveMfaTrustBundle,
  tryRestoreTrustedMfaSession,
} from '../../lib/practitioner-device-trust';
import {
  looksLikeTotpSetupPayload,
  mapMfaVerifyErrorToUserMessage,
  normalizeTotpCode,
} from '../../lib/mfa-user-messages';

type LoginStep = 'credentials' | 'mfa_verify';

/**
 * Practitioner email/password login with MFA step-up and optional device trust (browser storage).
 *
 * @returns Login UI.
 */
export default function LoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const { announce } = useAnnounce();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [rememberDevice, setRememberDevice] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [step, setStep] = useState<LoginStep>('credentials');
  const [loading, setLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setStatus(null);
    setLoading(true);

    try {
      const { error: authError } = await signInWithEmailPassword(
        supabase,
        email,
        password,
      );

      if (authError) {
        setError(authError.message);
        announce(authError.message, { politeness: 'assertive' });
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        const message = 'Could not resolve your account after sign-in.';
        setError(message);
        announce(message, { politeness: 'assertive' });
        return;
      }

      const factorsResult = await supabase.auth.mfa.listFactors();
      if (factorsResult.error) {
        throw factorsResult.error;
      }

      const verifiedTotpFactors = factorsResult.data.totp.filter(
        (factor) => factor.status === 'verified',
      );
      if (verifiedTotpFactors.length < 1) {
        const message =
          'No verified TOTP factor yet. Opening security setup so you can enroll TOTP.';
        announce(message, { politeness: 'assertive' });
        router.push('/');
        router.refresh();
        return;
      }

      const restored = await tryRestoreTrustedMfaSession(supabase, user.id);
      if (restored) {
        router.push('/patients');
        router.refresh();
        return;
      }

      const assurance =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assurance.error) {
        throw assurance.error;
      }

      if (assurance.data.currentLevel === 'aal2') {
        router.push('/patients');
        router.refresh();
        return;
      }

      setMfaFactorId(verifiedTotpFactors[0]?.id ?? null);
      setStep('mfa_verify');
      const message =
        'Enter the six-digit code from your authenticator app to continue.';
      setStatus(message);
      announce(message, { politeness: 'assertive' });
    } catch (nextError) {
      console.error(nextError);
      setError('Unable to sign in right now. Please try again.');
      announce('Unable to sign in right now. Please try again.', {
        politeness: 'assertive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyMfa = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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

      if (rememberDevice) {
        const { data: sessionData } = await supabase.auth.getSession();
        const session = sessionData.session;
        if (session) {
          saveMfaTrustBundle(session, getTrustedUntilMsAfterVerification());
        }
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
  };

  const showCredentialsStep = step === 'credentials';

  return (
    <div className="flex min-h-screen items-center justify-center bg-app-bg bg-app-gradient px-4">
      <div className="w-full max-w-md rounded-2xl border border-app-border/90 bg-app-surface p-8 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
        <h1 className="mb-2 text-center text-2xl font-bold text-app-ink">
          Practitioner login
        </h1>
        <p className="text-center text-sm text-app-muted">
          Sign in to set up and verify your TOTP factor.
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
            <div>
              <label
                htmlFor="mfa-code"
                className="block text-sm font-medium text-app-muted"
              >
                Authenticator code
              </label>
              <input
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

            <label className="flex items-start gap-2 text-sm text-app-muted">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-app-border text-app-primary focus:ring-app-ring"
                checked={rememberDevice}
                onChange={(event) => setRememberDevice(event.target.checked)}
              />
              <span>Trust this device for 30 days.</span>
            </label>

            <button
              type="submit"
              disabled={verifyLoading}
              className="w-full rounded-md bg-app-primary px-4 py-2 text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {verifyLoading ? 'Verifying code...' : 'Verify and continue'}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep('credentials');
                setVerifyCode('');
                setMfaFactorId(null);
                setRememberDevice(false);
                setStatus(null);
                setError(null);
              }}
              className="w-full rounded-md border border-app-border bg-app-surface px-4 py-2 text-app-ink transition hover:bg-[var(--app-nav-hover-bg)]"
            >
              Back to sign in
            </button>
          </form>
        )}

        <div className="mt-5 text-center">
          <Link
            href="/"
            className="text-sm font-medium text-app-primary underline-offset-2 hover:underline"
          >
            Open security setup
          </Link>
        </div>
      </div>
    </div>
  );
}
