'use client';

import { useAnnounce } from '@abstrack/ui/a11y-web';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/symptom-presets/ConfirmDialog';
import { useAuth } from '@/lib/auth-provider';
import {
  isUnenrollAlreadyGoneError,
  looksLikeTotpSetupPayload,
  mapMfaUnenrollErrorToUserMessage,
  mapMfaVerifyErrorToUserMessage,
  normalizeTotpCode,
} from '@/lib/mfa-user-messages';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import {
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH,
  USER_PASSWORD_SET_USER_METADATA_KEY,
  buildRevokedPasswordPlaceholder,
  clampAuthPasswordInput,
  getAuthPasswordValidationError,
  userHasPasswordSignIn,
} from '@/lib/user-password-sign-in';

type TotpEnrollment = {
  id: string;
  qrCodeImageSrc: string;
  secret: string;
  friendlyName: string;
};

type VerifiedTotpFactor = {
  id: string;
  friendlyName: string;
};

function getTotpIssuer(): string {
  return process.env.NEXT_PUBLIC_APP_NAME?.trim() || 'ABStrack';
}

function buildOtpauthUriFromSecret(secret: string, account: string): string {
  const issuer = getTotpIssuer();
  const labelAccount = account.trim() || 'account';
  const pathLabel = `${encodeURIComponent(issuer)}:${encodeURIComponent(labelAccount)}`;
  const url = new URL(`otpauth://totp/${pathLabel}`);
  url.searchParams.set('secret', secret);
  url.searchParams.set('issuer', issuer);
  url.searchParams.set('algorithm', 'SHA1');
  url.searchParams.set('digits', '6');
  url.searchParams.set('period', '30');
  return url.toString();
}

async function otpauthUriToQrPngDataUrl(otpauthUri: string): Promise<string> {
  const { toDataURL } = await import('qrcode');
  return toDataURL(otpauthUri, {
    errorCorrectionLevel: 'H',
    margin: 4,
    width: 320,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

const SETTINGS_SURFACE_CLASS =
  'rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8';

/**
 * Security settings: password add/change/revoke and optional TOTP enrollment.
 *
 * @returns Security section for the settings page.
 */
export function SettingsSecuritySection() {
  const formId = useId();
  const { announce } = useAnnounce();
  const { session, loading: authLoading } = useAuth();
  const supabase = useMemo(() => createBrowserClient(), []);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const [mfaLoading, setMfaLoading] = useState(true);
  const [verifiedFactors, setVerifiedFactors] = useState<VerifiedTotpFactor[]>(
    [],
  );
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyFailureMessage, setVerifyFailureMessage] = useState<
    string | null
  >(null);
  const [mfaStatusMessage, setMfaStatusMessage] = useState<string | null>(null);
  const [unenrollFactorId, setUnenrollFactorId] = useState<string | null>(null);
  const [unenrollError, setUnenrollError] = useState<string | null>(null);

  const hasPassword = userHasPasswordSignIn(session?.user);

  const refreshMfaState = useCallback(async () => {
    const factorsResult = await supabase.auth.mfa.listFactors();
    if (factorsResult.error) {
      throw factorsResult.error;
    }
    setVerifiedFactors(
      factorsResult.data.totp
        .filter((f) => f.status === 'verified')
        .map((f) => ({
          id: f.id,
          friendlyName: f.friendly_name ?? 'Authenticator',
        })),
    );
  }, [supabase]);

  useEffect(() => {
    if (authLoading || !session) {
      return;
    }
    const load = async () => {
      setMfaLoading(true);
      try {
        await refreshMfaState();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to load two-factor status.';
        setMfaStatusMessage(message);
        announce(message, { politeness: 'assertive' });
      } finally {
        setMfaLoading(false);
      }
    };
    void load();
  }, [authLoading, session, refreshMfaState, announce]);

  const onPasswordSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!session) {
      return;
    }
    const passwordValidationError = getAuthPasswordValidationError(password);
    if (passwordValidationError) {
      setPasswordError(passwordValidationError);
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }
    setPasswordSubmitting(true);
    setPasswordError(null);
    try {
      const { error } = await supabase.auth.updateUser({
        password,
        data: { [USER_PASSWORD_SET_USER_METADATA_KEY]: true },
      });
      if (error) {
        setPasswordError(error.message);
        announce(error.message, { politeness: 'assertive' });
        return;
      }
      setPassword('');
      setConfirmPassword('');
      await supabase.auth.refreshSession();
      const msg = hasPassword
        ? 'Password updated.'
        : 'Password added. You can sign in with your email and password on web or mobile.';
      announce(msg, { politeness: 'polite' });
    } catch {
      const msg = 'Unable to update password. Try again.';
      setPasswordError(msg);
      announce(msg, { politeness: 'assertive' });
    } finally {
      setPasswordSubmitting(false);
    }
  };

  const onRevokePassword = async () => {
    if (!session) {
      return false;
    }
    setRevokeError(null);
    try {
      const { error } = await supabase.auth.updateUser({
        password: buildRevokedPasswordPlaceholder(),
        data: { [USER_PASSWORD_SET_USER_METADATA_KEY]: false },
      });
      if (error) {
        const msg = error.message;
        setRevokeError(msg);
        announce(msg, { politeness: 'assertive' });
        return false;
      }
      setPassword('');
      setConfirmPassword('');
      await supabase.auth.refreshSession();
      announce(
        'Password sign-in disabled. Use magic links from email to sign in on supported apps.',
        { politeness: 'polite' },
      );
      return undefined;
    } catch {
      const msg = 'Unable to revoke password. Try again.';
      setRevokeError(msg);
      announce(msg, { politeness: 'assertive' });
      return false;
    }
  };

  const startEnrollment = async () => {
    if (!session) {
      return;
    }
    setIsEnrolling(true);
    setMfaStatusMessage(null);
    setVerifyFailureMessage(null);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `ABStrack device ${new Date().toISOString()}`,
      });
      if (error) {
        throw error;
      }
      const account = session.user.email ?? 'account';
      const otpauthUri = buildOtpauthUriFromSecret(data.totp.secret, account);
      const qrCodeImageSrc = await otpauthUriToQrPngDataUrl(otpauthUri);
      setEnrollment({
        id: data.id,
        qrCodeImageSrc,
        secret: data.totp.secret,
        friendlyName: data.friendly_name ?? 'Authenticator',
      });
      const msg =
        'Scan the QR code with your authenticator app, then enter the six-digit code.';
      setMfaStatusMessage(msg);
      announce(msg, { politeness: 'polite' });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to start two-factor enrollment.';
      setMfaStatusMessage(message);
      announce(message, { politeness: 'assertive' });
    } finally {
      setIsEnrolling(false);
    }
  };

  const verifyEnrollment = async () => {
    if (!enrollment || !session) {
      return;
    }
    setIsVerifying(true);
    setVerifyFailureMessage(null);
    if (!/^\d{6}$/.test(verifyCode)) {
      const msg =
        'Enter exactly six digits from your authenticator, not a setup link.';
      setVerifyFailureMessage(msg);
      announce(msg, { politeness: 'assertive' });
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
      setEnrollment(null);
      await refreshMfaState();
      const msg = 'Two-factor authentication is enabled.';
      setMfaStatusMessage(msg);
      announce(msg, { politeness: 'polite' });
    } catch (error) {
      const message = mapMfaVerifyErrorToUserMessage(error);
      setVerifyFailureMessage(message);
      announce(message, { politeness: 'assertive' });
    } finally {
      setIsVerifying(false);
    }
  };

  const cancelEnrollment = async () => {
    if (!enrollment) {
      return;
    }
    setIsCanceling(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({
        factorId: enrollment.id,
      });
      if (error && !isUnenrollAlreadyGoneError(error)) {
        const message = mapMfaUnenrollErrorToUserMessage(error);
        setMfaStatusMessage(message);
        announce(message, {
          politeness: 'assertive',
        });
        return;
      }
      setEnrollment(null);
      setVerifyCode('');
      setVerifyFailureMessage(null);
      await refreshMfaState();
      announce('Two-factor setup canceled.', { politeness: 'polite' });
    } catch {
      const message =
        'Unable to cancel two-factor setup. Check your connection and try again.';
      setMfaStatusMessage(message);
      announce(message, { politeness: 'assertive' });
    } finally {
      setIsCanceling(false);
    }
  };

  const onUnenrollFactor = async () => {
    if (!unenrollFactorId) {
      return false;
    }
    setUnenrollError(null);
    try {
      const { error } = await supabase.auth.mfa.unenroll({
        factorId: unenrollFactorId,
      });
      if (error && !isUnenrollAlreadyGoneError(error)) {
        const msg = mapMfaUnenrollErrorToUserMessage(error);
        setUnenrollError(msg);
        announce(msg, { politeness: 'assertive' });
        return false;
      }
      await refreshMfaState();
      announce('Authenticator removed.', { politeness: 'polite' });
      return undefined;
    } catch {
      const msg = 'Unable to remove authenticator. Try again.';
      setUnenrollError(msg);
      announce(msg, { politeness: 'assertive' });
      return false;
    }
  };

  if (authLoading) {
    return (
      <p className="text-sm text-app-muted" role="status">
        Loading security settings…
      </p>
    );
  }

  if (!session) {
    return (
      <p role="alert" className="text-sm text-red-700 dark:text-red-300">
        You must be signed in to manage security settings.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <section
        aria-labelledby={`${formId}-password-heading`}
        className={SETTINGS_SURFACE_CLASS}
      >
        <h2
          id={`${formId}-password-heading`}
          className="text-lg font-semibold text-app-ink"
        >
          {hasPassword ? 'Change password' : 'Add a password'}
        </h2>
        <p className="mt-2 text-sm text-app-muted">
          {hasPassword
            ? 'Update the password you use for email sign-in on web or mobile.'
            : 'You currently sign in with magic links from email. Add a password if you want email and password sign-in too.'}{' '}
          Passwords must be at least {AUTH_PASSWORD_MIN_LENGTH} characters and
          no more than {AUTH_PASSWORD_MAX_LENGTH} bytes.
        </p>
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            void onPasswordSubmit(e);
          }}
          noValidate
        >
          <div className="space-y-2">
            <label
              htmlFor={`${formId}-new-password`}
              className="text-sm font-medium text-app-ink"
            >
              {hasPassword ? 'New password' : 'Password'}
            </label>
            <input
              id={`${formId}-new-password`}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) =>
                setPassword(clampAuthPasswordInput(e.target.value))
              }
              className="mt-1 block w-full min-h-[44px] rounded-md border border-app-border bg-app-bg px-3 py-2 text-app-ink shadow-sm focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-ring"
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor={`${formId}-confirm-password`}
              className="text-sm font-medium text-app-ink"
            >
              Confirm password
            </label>
            <input
              id={`${formId}-confirm-password`}
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) =>
                setConfirmPassword(clampAuthPasswordInput(e.target.value))
              }
              className="mt-1 block w-full min-h-[44px] rounded-md border border-app-border bg-app-bg px-3 py-2 text-app-ink shadow-sm focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-ring"
            />
          </div>
          {passwordError ? (
            <p role="alert" className="text-sm text-red-700 dark:text-red-300">
              {passwordError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={passwordSubmitting}
            className="min-h-[44px] rounded-full bg-app-primary-solid px-5 text-sm font-semibold text-app-on-primary-solid shadow-sm transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-60"
          >
            {passwordSubmitting
              ? 'Saving…'
              : hasPassword
                ? 'Update password'
                : 'Add password'}
          </button>
        </form>
        {hasPassword ? (
          <div className="mt-6 border-t border-app-border/80 pt-6">
            <h3 className="text-sm font-semibold text-app-ink">
              Use magic links only
            </h3>
            <p className="mt-2 text-sm text-app-muted">
              Remove password sign-in and rely on magic links from email on
              supported apps. You will need a new invite or magic link to sign
              in after revoking.
            </p>
            <button
              type="button"
              className="mt-4 min-h-[44px] rounded-full border border-app-border px-4 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-app-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
              onClick={() => {
                setRevokeError(null);
                setRevokeOpen(true);
              }}
            >
              Revoke password sign-in
            </button>
          </div>
        ) : null}
      </section>

      <section
        aria-labelledby={`${formId}-totp-heading`}
        className={SETTINGS_SURFACE_CLASS}
      >
        <h2
          id={`${formId}-totp-heading`}
          className="text-lg font-semibold text-app-ink"
        >
          Two-factor authentication (TOTP)
        </h2>
        <p className="mt-2 text-sm text-app-muted">
          Optional for patients and caretakers. Add an authenticator app for an
          extra sign-in step. You can enroll multiple factors as a backup.
        </p>
        {mfaStatusMessage ? (
          <p className="mt-3 text-sm text-app-muted" role="status">
            {mfaStatusMessage}
          </p>
        ) : null}
        {mfaLoading ? (
          <p className="mt-4 text-sm text-app-muted" role="status">
            Loading two-factor status…
          </p>
        ) : (
          <>
            <p className="mt-4 text-sm text-app-ink">
              {verifiedFactors.length > 0
                ? `${verifiedFactors.length} verified authenticator${verifiedFactors.length === 1 ? '' : 's'} enrolled.`
                : 'No authenticator enrolled yet.'}
            </p>
            {verifiedFactors.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {verifiedFactors.map((factor) => (
                  <li
                    key={factor.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-app-border/80 bg-app-bg px-4 py-3"
                  >
                    <span className="text-sm text-app-ink">
                      {factor.friendlyName}
                    </span>
                    <button
                      type="button"
                      className="min-h-[44px] rounded-full border border-app-border px-4 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-app-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
                      onClick={() => {
                        setUnenrollError(null);
                        setUnenrollFactorId(factor.id);
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {!enrollment ? (
              <button
                type="button"
                disabled={isEnrolling}
                className="mt-4 min-h-[44px] rounded-full bg-app-primary-solid px-5 text-sm font-semibold text-app-on-primary-solid shadow-sm transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => void startEnrollment()}
              >
                {isEnrolling ? 'Starting…' : 'Set up authenticator'}
              </button>
            ) : null}
          </>
        )}
        {enrollment ? (
          <div className="mt-6 space-y-4 border-t border-app-border/80 pt-6">
            <div className="inline-block rounded-lg border border-app-border bg-white p-4">
              <img
                src={enrollment.qrCodeImageSrc}
                alt="TOTP enrollment QR code"
                width={320}
                height={320}
                className="block h-auto max-h-[min(80vw,20rem)] w-auto max-w-full"
              />
            </div>
            <p className="text-sm text-app-muted">
              Setup key:{' '}
              <code className="rounded bg-app-bg px-1 py-0.5 text-app-ink">
                {enrollment.secret}
              </code>
            </p>
            <label
              htmlFor={`${formId}-totp-code`}
              className="block text-sm font-medium text-app-ink"
            >
              Six-digit code
            </label>
            <input
              id={`${formId}-totp-code`}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={verifyCode}
              onChange={(event) => {
                const raw = event.target.value;
                if (looksLikeTotpSetupPayload(raw)) {
                  setVerifyCode('');
                  const msg =
                    'Enter only the six-digit code from your authenticator.';
                  setVerifyFailureMessage(msg);
                  announce(msg, { politeness: 'assertive' });
                  return;
                }
                setVerifyFailureMessage(null);
                setVerifyCode(normalizeTotpCode(raw));
              }}
              className="block w-full min-h-[44px] rounded-md border border-app-border bg-app-bg px-3 py-2 text-app-ink shadow-sm focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-ring"
            />
            {verifyFailureMessage ? (
              <p
                role="alert"
                className="text-sm text-red-700 dark:text-red-300"
              >
                {verifyFailureMessage}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={
                  isVerifying || isCanceling || !/^\d{6}$/.test(verifyCode)
                }
                className="min-h-[44px] rounded-full bg-app-primary-solid px-5 text-sm font-semibold text-app-on-primary-solid shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => void verifyEnrollment()}
              >
                {isVerifying ? 'Verifying…' : 'Verify and enable'}
              </button>
              <button
                type="button"
                disabled={isVerifying || isCanceling}
                className="min-h-[44px] rounded-full border border-app-border px-4 text-sm font-semibold text-app-ink shadow-sm"
                onClick={() => void cancelEnrollment()}
              >
                {isCanceling ? 'Canceling…' : 'Cancel setup'}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <ConfirmDialog
        open={revokeOpen}
        title="Revoke password sign-in?"
        description="You will no longer be able to sign in with your email and password. Use magic links from email on supported apps instead. This does not sign you out of your current session."
        confirmLabel="Revoke password"
        cancelLabel="Keep password"
        confirmBusyLabel="Revoking…"
        onConfirm={() => onRevokePassword()}
        onClose={() => {
          setRevokeOpen(false);
          setRevokeError(null);
        }}
      >
        {revokeError ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {revokeError}
          </p>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={unenrollFactorId != null}
        title="Remove authenticator?"
        description="You will need this device or another enrolled authenticator to complete two-factor sign-in if it is required for your account."
        confirmLabel="Remove"
        cancelLabel="Keep"
        confirmBusyLabel="Removing…"
        onConfirm={() => onUnenrollFactor()}
        onClose={() => {
          setUnenrollFactorId(null);
          setUnenrollError(null);
        }}
      >
        {unenrollError ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {unenrollError}
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
