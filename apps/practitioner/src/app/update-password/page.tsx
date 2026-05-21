'use client';

import { getSupabaseBrowserClient } from '@abstrack/supabase/browser';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PRACTITIONER_INVITE_SET_PASSWORD_FROM } from '@/lib/practitioner-invite-join';
import { PRACTITIONER_PASSWORD_SET_USER_METADATA_KEY } from '@/lib/practitioner-password-sign-in';

const MIN_PASSWORD_LENGTH = 8;

/**
 * Lets a signed-in practitioner set a password (`updateUser`). Post-invite flow
 * (`?from=practitioner-invite`) keeps the session and sends the user to TOTP enrollment at `/`.
 *
 * @returns Update / create password page.
 */
export default function PractitionerUpdatePasswordPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isInvitePassword, setIsInvitePassword] = useState(false);

  useEffect(() => {
    let mounted = true;

    const initialize = async () => {
      const params = new URLSearchParams(window.location.search);
      const errorParam = params.get('error');
      const fromParam = params.get('from');

      if (mounted) {
        setIsInvitePassword(
          fromParam === PRACTITIONER_INVITE_SET_PASSWORD_FROM,
        );
      }

      if (errorParam && mounted) {
        setError(errorParam);
      }

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user && mounted && !errorParam) {
          setError(
            fromParam === PRACTITIONER_INVITE_SET_PASSWORD_FROM
              ? 'You must be signed in to create a password. Open your invite link again, then return here.'
              : 'This sign-in link is invalid or expired. Request a new one.',
          );
        }
      } catch (sessionError) {
        console.error(sessionError);
        if (mounted) {
          setError(
            fromParam === PRACTITIONER_INVITE_SET_PASSWORD_FROM
              ? 'Unable to verify your session. Open your invite link again, or reload this page.'
              : 'Unable to validate sign-in link. Request a new one.',
          );
        }
      } finally {
        if (mounted) {
          setCheckingSession(false);
        }
      }
    };

    void initialize();

    return () => {
      mounted = false;
    };
  }, [supabase]);

  useEffect(() => {
    return () => {
      if (redirectTimeoutRef.current) {
        clearTimeout(redirectTimeoutRef.current);
      }
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      setStatus(null);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      setStatus(null);
      return;
    }

    setLoading(true);
    setError(null);
    setStatus(null);

    const postInvite =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('from') ===
        PRACTITIONER_INVITE_SET_PASSWORD_FROM;

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError(
          postInvite
            ? 'Your session expired. Open your invite link again, then return here to create a password.'
            : 'This sign-in link is invalid or expired. Request a new one.',
        );
        return;
      }

      const { error: authError } = await supabase.auth.updateUser({
        password,
        data: {
          [PRACTITIONER_PASSWORD_SET_USER_METADATA_KEY]: true,
        },
      });
      if (authError) {
        setError(authError.message);
        return;
      }

      const { error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr) {
        console.warn(
          'Practitioner update-password: refreshSession after metadata stamp',
          refreshErr,
        );
      }

      if (postInvite) {
        setStatus(
          'Password saved. Taking you to two-factor authentication setup…',
        );
        redirectTimeoutRef.current = setTimeout(() => {
          router.replace('/');
        }, 800);
        return;
      }

      await supabase.auth.signOut();
      setStatus('Password updated. Redirecting to login…');
      redirectTimeoutRef.current = setTimeout(() => {
        router.replace('/login');
      }, 1000);
    } catch (submitError) {
      console.error(submitError);
      setError('Unable to update password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main
      id="main-content"
      className="app-grid-background flex min-h-[calc(100svh-4.5rem)] items-center justify-center px-4 py-12"
    >
      <div className="w-full max-w-md rounded-2xl border border-app-border/90 bg-app-surface p-8 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
        <h1 className="mb-6 text-center text-2xl font-bold text-app-ink">
          {isInvitePassword ? 'Create your password' : 'Set new password'}
        </h1>

        {isInvitePassword && !checkingSession && !error ? (
          <p className="mb-4 text-center text-sm text-app-muted">
            You are signed in as a practitioner. Choose a password so you can
            sign in with your email and password next time. You will still need
            to set up two-factor authentication (TOTP) before opening patient
            records.
          </p>
        ) : null}

        {checkingSession ? (
          <p className="mb-4 text-sm text-app-muted" role="status">
            {isInvitePassword
              ? 'Checking your session…'
              : 'Validating sign-in link…'}
          </p>
        ) : null}

        {error ? (
          <p
            className="mb-4 text-sm text-red-700 dark:text-red-300"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {status ? (
          <p className="mb-4 text-sm text-app-primary" role="status">
            {status}
          </p>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-app-ink"
            >
              {isInvitePassword ? 'Password' : 'New password'}
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              className="mt-1 block w-full min-h-[44px] rounded-md border border-app-border bg-app-bg px-3 py-2 text-app-ink shadow-sm focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-ring"
              placeholder="••••••••"
            />
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium text-app-ink"
            >
              {isInvitePassword ? 'Confirm password' : 'Confirm new password'}
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              className="mt-1 block w-full min-h-[44px] rounded-md border border-app-border bg-app-bg px-3 py-2 text-app-ink shadow-sm focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-ring"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading || checkingSession}
            className="min-h-[44px] w-full rounded-full bg-app-primary-solid px-4 py-2 text-sm font-semibold text-app-on-primary-solid transition hover:brightness-105 disabled:opacity-50"
          >
            {loading
              ? isInvitePassword
                ? 'Saving…'
                : 'Updating…'
              : isInvitePassword
                ? 'Save password'
                : 'Update password'}
          </button>
        </form>

        {isInvitePassword ? (
          <p className="mt-4 text-center text-sm text-app-muted">
            <Link href="/patients" className="text-app-primary hover:underline">
              Skip for now
            </Link>
            {' — '}
            open the patient workspace with magic-link sign-in. Two-factor
            authentication is only required if you save a password here.
          </p>
        ) : (
          <p className="mt-4 text-center text-sm text-app-muted">
            <Link href="/login" className="text-app-primary hover:underline">
              Back to login
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
