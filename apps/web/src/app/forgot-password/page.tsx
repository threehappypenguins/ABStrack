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

      setStatus('Password reset email sent. Check your inbox for the recovery link.');
    } catch (submitError) {
      console.error(submitError);
      setError('Unable to send reset email. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <h1 className="text-2xl font-bold mb-6 text-center">Forgot password</h1>

        {error ? (
          <div className="mb-4 p-4 bg-red-50 text-red-700 rounded border border-red-200">
            {error}
          </div>
        ) : null}

        {status ? (
          <div className="mb-4 p-4 bg-blue-50 text-blue-700 rounded border border-blue-200">
            {status}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              placeholder="you@example.com"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
          >
            {loading ? 'Sending reset email...' : 'Send reset email'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-gray-600">
          Remembered your password?{' '}
          <Link href="/login" className="text-blue-600 hover:underline">
            Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}