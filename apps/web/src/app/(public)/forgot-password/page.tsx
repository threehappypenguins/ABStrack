'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { resetPasswordForEmail } from '@abstrack/supabase';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setStatus(null);

    try {
      const supabase = createBrowserClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=/update-password`;
      const { error: authError } = await resetPasswordForEmail(
        supabase,
        email.trim(),
        { redirectTo },
      );

      if (authError) {
        setError(authError.message);
        return;
      }

      setStatus(
        'Password reset email sent. Check your inbox for the recovery link.',
      );
    } catch (submitError) {
      console.error(submitError);
      setError('Unable to send reset email. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-transparent px-4">
      <div className="w-full max-w-md rounded-2xl border border-app-border/90 bg-app-surface p-8 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
        <h1 className="mb-6 text-center text-2xl font-bold text-app-ink">
          Forgot password
        </h1>

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
              htmlFor="email"
              className="block text-sm font-medium text-app-muted"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-app-ink shadow-sm focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-ring"
              placeholder="you@example.com"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-app-primary-solid px-4 py-2 text-app-on-primary-solid transition hover:brightness-105 disabled:opacity-50"
          >
            {loading ? 'Sending reset email...' : 'Send reset email'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-app-muted">
          Remembered your password?{' '}
          <Link href="/login" className="text-app-primary hover:underline">
            Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}
