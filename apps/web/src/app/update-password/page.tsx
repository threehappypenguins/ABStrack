'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { updateUserPassword } from '@abstrack/supabase';

const MIN_PASSWORD_LENGTH = 8;

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

  useEffect(() => {
    let mounted = true;

    const initialize = async () => {
      const errorParam = new URLSearchParams(window.location.search).get(
        'error',
      );
      if (errorParam && mounted) {
        setError(errorParam);
      }

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session && mounted && !errorParam) {
          setError('This reset link is invalid or expired. Request a new one.');
        }
      } catch (sessionError) {
        console.error(sessionError);
        if (mounted) {
          setError('Unable to validate reset link. Request a new one.');
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

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setError('This reset link is invalid or expired. Request a new one.');
        return;
      }

      const { error: authError } = await updateUserPassword(supabase, password);
      if (authError) {
        setError(authError.message);
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
    <div className="flex min-h-screen items-center justify-center bg-app-bg bg-app-gradient px-4">
      <div className="w-full max-w-md rounded-2xl border border-app-border/90 bg-app-surface p-8 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
        <h1 className="mb-6 text-center text-2xl font-bold text-app-ink">
          Set new password
        </h1>

        {checkingSession ? (
          <div className="mb-4 rounded border border-app-border bg-app-bg p-4 text-app-ink">
            Validating reset link...
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
              New password
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
              Confirm new password
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
            className="w-full rounded-md bg-app-primary px-4 py-2 text-white transition hover:brightness-105 disabled:opacity-50"
          >
            {loading ? 'Updating...' : 'Update password'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-app-muted">
          Need a new link?{' '}
          <Link
            href="/forgot-password"
            className="text-app-primary hover:underline"
          >
            Forgot password
          </Link>
        </p>
      </div>
    </div>
  );
}
