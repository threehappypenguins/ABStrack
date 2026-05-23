'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CARETAKER_INVITE_SET_PASSWORD_FROM } from '@/lib/auth/caretaker-invite-password';
import { PUBLIC_PAGE_CENTER_CLASS } from '@/components/app-shell/public-page-layout-classes';
import {
  AUTH_CALLBACK_INVALID_LINK_MESSAGE,
  AUTH_CALLBACK_VERIFICATION_FAILED_MESSAGE,
} from '@/lib/auth/auth-callback-redirect';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { USER_PASSWORD_SET_USER_METADATA_KEY } from '@/lib/user-password-sign-in';

const MIN_PASSWORD_LENGTH = 8;

/**
 * Lets a signed-in user set or change their password (`updateUser`). Supports the post–caretaker-invite
 * flow (`?from=caretaker-invite`): after success, keeps the session and sends the user home instead of
 * signing out (recovery links from email still sign out and return to login).
 *
 * @returns Update / create password page.
 */
export default function UpdatePasswordPage() {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserClient(), []);
  const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isCaretakerInvitePassword, setIsCaretakerInvitePassword] =
    useState(false);

  useEffect(() => {
    let mounted = true;

    const initialize = async () => {
      const params = new URLSearchParams(window.location.search);
      const errorParam = params.get('error');
      const fromParam = params.get('from');

      if (mounted) {
        setIsCaretakerInvitePassword(
          fromParam === CARETAKER_INVITE_SET_PASSWORD_FROM,
        );
      }

      if (errorParam && mounted) {
        setError(errorParam);
      }

      try {
        const {
          data: { user },
          error: getUserError,
        } = await supabase.auth.getUser();

        if (getUserError) {
          console.error(
            'Failed to verify user on update-password page',
            getUserError,
          );
          if (mounted && !errorParam) {
            setError(
              fromParam === CARETAKER_INVITE_SET_PASSWORD_FROM
                ? 'Unable to verify your session. Open your invite link again, or reload this page.'
                : AUTH_CALLBACK_VERIFICATION_FAILED_MESSAGE,
            );
          }
        } else if (!user && mounted && !errorParam) {
          setError(
            fromParam === CARETAKER_INVITE_SET_PASSWORD_FROM
              ? 'You must be signed in to create a password. Open your invite link again, then return here.'
              : AUTH_CALLBACK_INVALID_LINK_MESSAGE,
          );
        }
      } catch (sessionError) {
        console.error(sessionError);
        if (mounted && !errorParam) {
          setError(
            fromParam === CARETAKER_INVITE_SET_PASSWORD_FROM
              ? 'Unable to verify your session. Open your invite link again, or reload this page.'
              : AUTH_CALLBACK_VERIFICATION_FAILED_MESSAGE,
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

    const postInviteCaretaker =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('from') ===
        CARETAKER_INVITE_SET_PASSWORD_FROM;

    try {
      const {
        data: { user },
        error: getUserError,
      } = await supabase.auth.getUser();

      if (getUserError) {
        console.error(
          'Failed to verify user before password update',
          getUserError,
        );
        setError(
          postInviteCaretaker
            ? 'Unable to verify your session. Open your invite link again, or reload this page.'
            : AUTH_CALLBACK_VERIFICATION_FAILED_MESSAGE,
        );
        return;
      }

      if (!user) {
        setError(
          postInviteCaretaker
            ? 'Your session expired. Open your invite link again, then return here to create a password.'
            : AUTH_CALLBACK_INVALID_LINK_MESSAGE,
        );
        return;
      }

      const { error: authError } = await supabase.auth.updateUser({
        password,
        data: { [USER_PASSWORD_SET_USER_METADATA_KEY]: true },
      });
      if (authError) {
        setError(authError.message);
        return;
      }

      if (postInviteCaretaker) {
        setStatus('Password saved. Taking you home…');
        redirectTimeoutRef.current = setTimeout(() => {
          router.replace('/');
        }, 800);
        return;
      }

      await supabase.auth.signOut();
      setStatus('Password updated. Redirecting to login...');
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
    <div className={PUBLIC_PAGE_CENTER_CLASS}>
      <div className="w-full max-w-md rounded-2xl border border-app-border/90 bg-app-surface p-8 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
        <h1 className="mb-6 text-center text-2xl font-bold text-app-ink">
          {isCaretakerInvitePassword
            ? 'Create your password'
            : 'Set new password'}
        </h1>

        {isCaretakerInvitePassword && !checkingSession && !error ? (
          <p className="mb-4 text-center text-sm text-app-muted">
            You are signed in as a caretaker. Choose a password so you can sign
            in with your email next time—without using another invite link.
          </p>
        ) : null}

        {checkingSession ? (
          <div className="mb-4 rounded border border-app-border bg-app-bg p-4 text-app-ink">
            {isCaretakerInvitePassword
              ? 'Checking your session…'
              : 'Validating sign-in link…'}
          </div>
        ) : null}

        {error ? (
          <div className="mb-4 rounded border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800/60 dark:bg-red-950/35 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {status ? (
          <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-4 text-blue-800 dark:border-blue-800/60 dark:bg-blue-950/35 dark:text-blue-200">
            {status}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-app-muted"
            >
              {isCaretakerInvitePassword ? 'Password' : 'New password'}
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-app-ink shadow-sm focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-ring"
              placeholder="••••••••"
            />
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium text-app-muted"
            >
              {isCaretakerInvitePassword
                ? 'Confirm password'
                : 'Confirm new password'}
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-app-ink shadow-sm focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-ring"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading || checkingSession}
            className="w-full rounded-md bg-app-primary-solid px-4 py-2 text-app-on-primary-solid transition hover:brightness-105 disabled:opacity-50"
          >
            {loading
              ? isCaretakerInvitePassword
                ? 'Saving…'
                : 'Updating…'
              : isCaretakerInvitePassword
                ? 'Save password'
                : 'Update password'}
          </button>
        </form>

        {isCaretakerInvitePassword ? (
          <p className="mt-4 text-center text-sm text-app-muted">
            <Link href="/" className="text-app-primary hover:underline">
              Skip for now
            </Link>
            {' — '}
            you can set a password later using{' '}
            <Link
              href="/forgot-password"
              className="text-app-primary hover:underline"
            >
              Forgot password
            </Link>{' '}
            on the login page with this email address.
          </p>
        ) : (
          <p className="mt-4 text-center text-sm text-app-muted">
            Need a new link?{' '}
            <Link
              href="/forgot-password"
              className="text-app-primary hover:underline"
            >
              Forgot password
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
