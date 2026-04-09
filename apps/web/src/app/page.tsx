'use client';

import { useAuth } from '../lib/auth-provider';
import Link from 'next/link';

export default function Index() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app-bg bg-app-gradient px-4">
        <div className="text-center">
          <div
            className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-app-primary border-t-transparent"
            aria-hidden
          />
          <p className="text-sm font-medium text-app-muted">Loading…</p>
        </div>
      </div>
    );
  }

  if (session) {
    return (
      <div className="min-h-screen bg-app-bg bg-app-gradient px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-md rounded-2xl border border-app-border/90 bg-app-surface p-8 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
          <h1 className="text-2xl font-bold tracking-tight text-app-ink">
            Welcome to ABStrack
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-app-muted">
            You are signed in. Open the app shell to manage presets and your
            dashboard.
          </p>

          <div className="mt-8 space-y-3">
            <Link
              href="/dashboard"
              className="block w-full rounded-full bg-app-primary py-3 text-center text-sm font-semibold text-white shadow-sm transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
            >
              Go to Dashboard
            </Link>
            <Link
              href="/presets/symptoms"
              className="block w-full rounded-full border border-app-border bg-app-surface py-3 text-center text-sm font-semibold text-app-ink shadow-sm transition hover:bg-[var(--app-nav-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
            >
              Symptom presets
            </Link>
            <Link
              href="/presets/health-markers"
              className="block w-full rounded-full border border-app-border bg-app-surface py-3 text-center text-sm font-semibold text-app-ink shadow-sm transition hover:bg-[var(--app-nav-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
            >
              Health marker presets
            </Link>
            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                className="w-full rounded-full border border-red-300/80 bg-red-50 py-3 text-sm font-semibold text-red-900 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:border-red-700/60 dark:bg-red-950/40 dark:text-red-100 dark:hover:bg-red-950/60"
              >
                Log out
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-app-bg bg-app-gradient px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-md rounded-2xl border border-app-border/90 bg-app-surface p-8 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
        <h1 className="text-center text-3xl font-bold tracking-tight text-app-ink">
          ABStrack
        </h1>
        <p className="mt-3 text-center text-sm leading-relaxed text-app-muted">
          Health tracking for Auto-Brewery Syndrome — private, accessible, and
          built for real episodes.
        </p>

        <div className="mt-8 space-y-3">
          <Link
            href="/login"
            className="block w-full rounded-full bg-app-primary py-3 text-center text-sm font-semibold text-white shadow-sm transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="block w-full rounded-full border border-emerald-600/35 bg-emerald-50 py-3 text-center text-sm font-semibold text-emerald-900 shadow-sm transition hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:border-emerald-500/40 dark:bg-emerald-950/35 dark:text-emerald-100 dark:hover:bg-emerald-950/55"
          >
            Sign up
          </Link>
        </div>

        <p className="mt-8 text-center text-xs text-app-muted">
          Open source. Your data stays yours.
        </p>
      </div>
    </div>
  );
}
