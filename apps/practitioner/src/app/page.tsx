'use client';

import { getSupabaseBrowserClient } from '@abstrack/supabase/browser';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth-provider';
import {
  isUnenrollAlreadyGoneError,
  looksLikeTotpSetupPayload,
  mapMfaUnenrollErrorToUserMessage,
  mapMfaVerifyErrorToUserMessage,
  normalizeTotpCode,
} from '../lib/mfa-user-messages';
import { PractitionerSignOutButton } from '../components/practitioner-sign-out-button';

type TotpEnrollment = {
  id: string;
  qrCodeImageSrc: string;
  secret: string;
  friendlyName: string;
};

/**
 * Issuer label shown in authenticator apps for the enrollment QR.
 * Set `NEXT_PUBLIC_APP_NAME` per deployment so labels stay explicit; if unset, defaults to `ABStrack`.
 *
 * @returns Display issuer string.
 */
function getTotpIssuer(): string {
  return process.env.NEXT_PUBLIC_APP_NAME?.trim() || 'ABStrack';
}

/**
 * Builds a Key URI–compatible `otpauth://` string from the enrolled secret. We generate the QR
 * from this locally so authenticator apps see a stable issuer/account label. Supabase may return
 * `qr_code` as SVG or raw URI with `localhost` embedded; encoding that bitmap bypasses our labels.
 * Verification still uses the same `secret` returned by enroll.
 *
 * @param secret - Base32 secret from `mfa.enroll()`.
 * @param account - Account name (typically the user email).
 * @returns Full `otpauth://totp/...` URI.
 */
function buildOtpauthUriFromSecret(secret: string, account: string): string {
  const issuer = getTotpIssuer();
  const labelAccount = account.trim() || 'practitioner';
  // Key URI label is `issuer:account` with a **literal** colon. Encoding the whole string as one
  // component turns `:` into `%3A`; many apps then fail to parse otpauth and paste the URI as text.
  // Encode issuer and account separately, then join with `:` (matches common Google Authenticator URIs).
  const pathLabel = `${encodeURIComponent(issuer)}:${encodeURIComponent(labelAccount)}`;
  const url = new URL(`otpauth://totp/${pathLabel}`);
  url.searchParams.set('secret', secret);
  url.searchParams.set('issuer', issuer);
  url.searchParams.set('algorithm', 'SHA1');
  url.searchParams.set('digits', '6');
  url.searchParams.set('period', '30');
  return url.toString();
}

/**
 * Encodes an `otpauth://` URI as a PNG data URL for use in `<img src>`.
 *
 * @param otpauthUri - Full TOTP key URI.
 * @returns Data URL for a PNG QR code.
 */
async function otpauthUriToQrPngDataUrl(otpauthUri: string): Promise<string> {
  const { toDataURL } = await import('qrcode');
  return toDataURL(otpauthUri, {
    errorCorrectionLevel: 'H',
    // Wider quiet zone + pure B/W helps some in-app scanners (e.g. picky camera pipelines).
    margin: 4,
    width: 320,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

/**
 * Practitioner home: TOTP MFA enrollment and session verification.
 *
 * @returns Client page rendering enrollment status and setup actions.
 */
export default function Index() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const { announce } = useAnnounce();
  const { session, loading: sessionLoading, gate } = useAuth();

  const [isLoading, setIsLoading] = useState(true);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [verifiedTotpCount, setVerifiedTotpCount] = useState(0);
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<'polite' | 'assertive'>(
    'polite',
  );
  /** Inline message under the code field when verify/challenge fails (not only in page header). */
  const [verifyFailureMessage, setVerifyFailureMessage] = useState<
    string | null
  >(null);
  const [isCanceling, setIsCanceling] = useState(false);

  const mfaReady = verifiedTotpCount > 0;

  const setAccessibleStatus = (
    message: string,
    tone: 'polite' | 'assertive' = 'polite',
  ) => {
    setStatusMessage(message);
    setStatusTone(tone);
    announce(message, { politeness: tone });
  };

  const refreshMfaState = async () => {
    const factorsResult = await supabase.auth.mfa.listFactors();
    if (factorsResult.error) {
      throw factorsResult.error;
    }
    setVerifiedTotpCount(
      factorsResult.data.totp.filter((f) => f.status === 'verified').length,
    );
  };

  useEffect(() => {
    if (gate.kind !== 'profile_error') {
      return;
    }
    console.error('Practitioner profile load failed', gate.error);
  }, [gate]);

  useEffect(() => {
    if (sessionLoading) {
      return;
    }

    const isAuthenticated = Boolean(session?.access_token);
    setUserEmail(session?.user.email ?? null);

    const load = async () => {
      setIsLoading(true);
      if (!isAuthenticated) {
        setEnrollment(null);
        setVerifyCode('');
        setVerifyFailureMessage(null);
        setVerifiedTotpCount(0);
        setIsLoading(false);
        return;
      }

      // Only list MFA factors for practitioner profiles; avoid API + SR noise on error gates.
      if (gate.kind !== 'practitioner') {
        setEnrollment(null);
        setVerifyCode('');
        setVerifyFailureMessage(null);
        setVerifiedTotpCount(0);
        setStatusMessage(null);
        setIsLoading(false);
        return;
      }

      try {
        await refreshMfaState();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to load your MFA status right now.';
        setAccessibleStatus(message, 'assertive');
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [session, sessionLoading, gate.kind]);

  const startEnrollment = async () => {
    const isAuthenticated = Boolean(session?.access_token);
    if (!isAuthenticated) {
      setAccessibleStatus(
        'You must sign in to a practitioner account before setting up TOTP.',
        'assertive',
      );
      return;
    }

    setIsEnrolling(true);
    setStatusMessage(null);
    setVerifyFailureMessage(null);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Practitioner device ${new Date().toISOString()}`,
      });
      if (error) {
        throw error;
      }

      const account = session?.user?.email ?? userEmail ?? 'practitioner';
      const otpauthUri = buildOtpauthUriFromSecret(data.totp.secret, account);
      const qrCodeImageSrc = await otpauthUriToQrPngDataUrl(otpauthUri);
      setEnrollment({
        id: data.id,
        qrCodeImageSrc,
        secret: data.totp.secret,
        friendlyName: data.friendly_name ?? 'Practitioner TOTP',
      });
      setAccessibleStatus(
        'TOTP enrollment is ready. Scan the QR code and enter your six-digit code to verify.',
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to start TOTP enrollment. Please try again.';
      setAccessibleStatus(message, 'assertive');
    } finally {
      setIsEnrolling(false);
    }
  };

  const verifyEnrollment = async () => {
    if (!enrollment) {
      return;
    }
    const isAuthenticated = Boolean(session?.access_token);
    if (!isAuthenticated) {
      setAccessibleStatus(
        'Your session is missing or expired. Sign in again, then retry verification.',
        'assertive',
      );
      return;
    }

    setIsVerifying(true);
    setStatusMessage(null);
    if (!/^\d{6}$/.test(verifyCode)) {
      const msg =
        'Enter exactly six digits from your authenticator, not a setup link.';
      setVerifyFailureMessage(msg);
      setAccessibleStatus(msg, 'assertive');
      setIsVerifying(false);
      return;
    }
    try {
      const challenge = await supabase.auth.mfa.challenge({
        factorId: enrollment.id,
      });
      if (challenge.error) {
        throw challenge.error;
      }

      const verify = await supabase.auth.mfa.verify({
        factorId: enrollment.id,
        challengeId: challenge.data.id,
        code: verifyCode,
      });
      if (verify.error) {
        throw verify.error;
      }

      setVerifyCode('');
      setVerifyFailureMessage(null);
      setEnrollment(null);
      await refreshMfaState();
      setAccessibleStatus(
        'Two-factor authentication is enabled for your practitioner account.',
      );
    } catch (error) {
      const message = mapMfaVerifyErrorToUserMessage(error);
      setVerifyFailureMessage(message);
      setAccessibleStatus(message, 'assertive');
    } finally {
      setIsVerifying(false);
    }
  };

  const clearEnrollmentUiAfterCancel = async () => {
    setEnrollment(null);
    setVerifyCode('');
    setVerifyFailureMessage(null);
    try {
      await refreshMfaState();
    } catch {
      /* listFactors failure is non-blocking after successful unenroll */
    }
    setAccessibleStatus(
      'TOTP setup was canceled. You can restart enrollment whenever you are ready.',
    );
  };

  const cancelEnrollment = async () => {
    if (!enrollment) {
      return;
    }
    setIsCanceling(true);
    setVerifyFailureMessage(null);
    try {
      const { error } = await supabase.auth.mfa.unenroll({
        factorId: enrollment.id,
      });
      if (error) {
        if (isUnenrollAlreadyGoneError(error)) {
          await clearEnrollmentUiAfterCancel();
        } else {
          setAccessibleStatus(
            mapMfaUnenrollErrorToUserMessage(error),
            'assertive',
          );
        }
        return;
      }
      await clearEnrollmentUiAfterCancel();
    } catch (error: unknown) {
      if (isUnenrollAlreadyGoneError(error)) {
        await clearEnrollmentUiAfterCancel();
      } else {
        setAccessibleStatus(
          mapMfaUnenrollErrorToUserMessage(error),
          'assertive',
        );
      }
    } finally {
      setIsCanceling(false);
    }
  };

  const isAuthenticated = Boolean(session?.access_token);
  const showLoadingState = sessionLoading || isLoading;

  if (sessionLoading) {
    return (
      <div
        id="practitioner-home"
        className="flex min-h-screen flex-col items-center justify-center bg-app-bg bg-app-gradient px-4 py-12 sm:px-6 lg:px-8"
        role="status"
        aria-busy="true"
        aria-live="polite"
      >
        <p className="text-center text-sm text-app-muted">
          Checking sign-in status…
        </p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div
        id="practitioner-home"
        className="min-h-screen bg-app-bg bg-app-gradient px-4 py-12 sm:px-6 lg:px-8"
      >
        <div className="mx-auto max-w-md rounded-2xl border border-app-border/90 bg-app-surface p-8 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
          <h1 className="text-center text-3xl font-bold tracking-tight text-app-ink">
            ABStrack Practitioner
          </h1>
          <p className="mt-3 text-center text-sm leading-relaxed text-app-muted">
            Secure practitioner access for patient support and care workflows.
          </p>

          <div className="mt-8 space-y-3">
            <Link
              href="/login"
              className="block w-full rounded-full bg-app-primary py-3 text-center text-sm font-semibold text-white shadow-sm transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
            >
              Log in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (gate.kind === 'profile_error') {
    return (
      <div
        id="practitioner-home"
        className="mx-auto max-w-lg px-4 py-12 sm:px-6"
        role="alert"
      >
        <h1 className="text-xl font-semibold text-app-ink">
          Could not load your profile
        </h1>
        <p className="mt-3 text-sm text-app-muted">
          Something went wrong while loading your account. Try signing out and
          signing in again. If this keeps happening, try again later.
        </p>
        <div className="mt-6">
          <PractitionerSignOutButton />
        </div>
      </div>
    );
  }

  if (gate.kind === 'profile_missing') {
    return (
      <div
        id="practitioner-home"
        className="mx-auto max-w-lg px-4 py-12 sm:px-6"
        role="alert"
      >
        <h1 className="text-xl font-semibold text-app-ink">
          No profile for this account
        </h1>
        <p className="mt-3 text-sm text-app-muted">
          This sign-in does not have an ABStrack profile yet. Practitioner
          accounts must be created through the correct invitation flow.
        </p>
        <div className="mt-6">
          <PractitionerSignOutButton />
        </div>
      </div>
    );
  }

  if (gate.kind === 'wrong_app_role') {
    return (
      <div
        id="practitioner-home"
        className="mx-auto max-w-lg px-4 py-12 sm:px-6"
        role="alert"
      >
        <h1 className="text-xl font-semibold text-app-ink">
          Wrong account type for this app
        </h1>
        <p className="mt-3 text-sm text-app-muted">
          This app is for healthcare practitioners. Your account is registered
          as <span className="font-medium text-app-ink">{gate.appRole}</span>.
          Use the patient or caretaker app instead.
        </p>
        <p className="mt-3 text-sm text-app-muted">
          Sign out to use a different account, or open the patient or caretaker
          app.
        </p>
        <div className="mt-6">
          <PractitionerSignOutButton />
        </div>
      </div>
    );
  }

  const mfaAssuranceReady =
    gate.kind === 'practitioner' && gate.hasMfaAssuranceAal2;

  return (
    <div id="practitioner-home" className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-app-ink">
          Two-factor authentication
        </h1>
        <p className="mt-2 text-sm text-app-muted">
          Enroll at least one TOTP factor to make this practitioner account
          MFA-ready.
          {mfaAssuranceReady ? (
            <span className="mt-2 block text-emerald-800 dark:text-emerald-200">
              Current session has MFA assurance (AAL2) for patient-data access.
            </span>
          ) : (
            <span className="mt-2 block">
              After you verify TOTP, complete a challenge when prompted so your
              session reaches AAL2 — required for patient data access.
            </span>
          )}
        </p>
        {userEmail ? (
          <p
            className="mt-2 text-sm text-app-muted"
            aria-label={`Signed in as ${userEmail}`}
          >
            Signed in as {userEmail}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {isAuthenticated ? (
            <PractitionerSignOutButton />
          ) : (
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:brightness-105"
            >
              Log in
            </Link>
          )}
          {mfaAssuranceReady && mfaReady ? (
            <Link
              href="/patients"
              className="inline-flex min-h-11 items-center rounded-md bg-emerald-800 px-4 py-2 text-sm font-medium text-white transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:bg-emerald-700"
            >
              Patient workspace
            </Link>
          ) : null}
        </div>
      </header>

      <section
        className="rounded-xl border border-app-border bg-app-surface p-5 shadow-soft"
        aria-labelledby="mfa-status-heading"
      >
        <h2
          id="mfa-status-heading"
          className="text-lg font-semibold text-app-ink"
        >
          MFA readiness status
        </h2>
        <p className="mt-2 text-sm text-app-muted">
          {showLoadingState
            ? 'Loading current MFA status...'
            : !isAuthenticated
              ? 'No active practitioner session detected. Sign in before enrolling TOTP.'
              : mfaReady
                ? `MFA ready. You have ${verifiedTotpCount} verified TOTP factor${verifiedTotpCount === 1 ? '' : 's'}.`
                : 'MFA not ready yet. Add and verify a TOTP factor to complete setup.'}
        </p>

        {statusTone === 'assertive' ? (
          <p
            role="alert"
            aria-live="assertive"
            className="mt-3 min-h-6 text-sm text-app-muted"
          >
            {statusMessage}
          </p>
        ) : (
          <p
            role="status"
            aria-live="polite"
            className="mt-3 min-h-6 text-sm text-app-muted"
          >
            {statusMessage}
          </p>
        )}

        {!mfaReady && !enrollment ? (
          <button
            type="button"
            onClick={startEnrollment}
            disabled={showLoadingState || isEnrolling || !isAuthenticated}
            className="mt-4 min-h-11 rounded-md bg-app-primary px-4 py-2 text-sm font-medium text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isEnrolling ? 'Starting enrollment...' : 'Set up TOTP'}
          </button>
        ) : null}
      </section>

      {enrollment ? (
        <section
          className="mt-6 rounded-xl border border-app-border bg-app-surface p-5 shadow-soft"
          aria-labelledby="totp-enroll-heading"
        >
          <h2
            id="totp-enroll-heading"
            className="text-lg font-semibold text-app-ink"
          >
            Verify authenticator app
          </h2>

          <div className="mt-4 inline-block rounded-lg border border-app-border bg-white p-4 dark:border-app-border dark:bg-white">
            <img
              src={enrollment.qrCodeImageSrc}
              alt="TOTP enrollment QR code"
              width={320}
              height={320}
              className="block h-auto max-h-[min(80vw,20rem)] w-auto max-w-full"
            />
          </div>

          <p className="mt-4 text-sm text-app-muted">
            Setup key:{' '}
            <code className="rounded bg-app-bg px-1 py-0.5 text-app-ink">
              {enrollment.secret}
            </code>
          </p>
          <p className="mt-2 text-xs text-app-muted">
            Factor name: {enrollment.friendlyName}
          </p>

          <label
            htmlFor="totp-code"
            className="mt-4 block text-sm font-medium text-app-ink"
          >
            Six-digit code
          </label>
          <input
            id="totp-code"
            name="totp-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            className={`mt-1 w-full rounded-md border bg-app-bg px-3 py-2 text-base text-app-ink focus:outline-none focus:ring-2 focus:ring-app-ring ${
              verifyFailureMessage
                ? 'border-red-600 focus:border-red-600 dark:border-red-500 dark:focus:border-red-500'
                : 'border-app-border focus:border-app-primary'
            }`}
            value={verifyCode}
            onChange={(event) => {
              const raw = event.target.value;
              if (looksLikeTotpSetupPayload(raw)) {
                setVerifyCode('');
                const msg =
                  'Enter only the six-digit code from your authenticator, not the setup link or key URI.';
                setVerifyFailureMessage(msg);
                setAccessibleStatus(msg, 'assertive');
                return;
              }
              setVerifyFailureMessage(null);
              setVerifyCode(normalizeTotpCode(raw));
            }}
            aria-describedby={
              verifyFailureMessage
                ? 'totp-verify-error totp-code-help'
                : 'totp-code-help'
            }
          />
          {verifyFailureMessage ? (
            <p
              id="totp-verify-error"
              role="alert"
              className="mt-2 text-sm text-red-700 dark:text-red-200"
            >
              {verifyFailureMessage}
            </p>
          ) : null}
          <p id="totp-code-help" className="mt-2 text-xs text-app-muted">
            Enter digits only — not the otpauth link. If the code fails, wait
            for a new code cycle and try again.
          </p>

          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={verifyEnrollment}
              disabled={
                isVerifying || isCanceling || !/^\d{6}$/.test(verifyCode)
              }
              className="min-h-11 rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-emerald-300"
            >
              {isVerifying ? 'Verifying code...' : 'Verify and finish'}
            </button>
            <button
              type="button"
              onClick={() => void cancelEnrollment()}
              disabled={isVerifying || isCanceling}
              className="min-h-11 rounded-md border border-app-border bg-app-surface px-4 py-2 text-sm font-medium text-app-ink transition hover:bg-[var(--app-nav-hover-bg)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCanceling ? 'Canceling…' : 'Cancel'}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
