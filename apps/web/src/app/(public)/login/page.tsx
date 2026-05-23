'use client';

import Link from 'next/link';
import { UserLoginForm } from '@/components/auth/UserLoginForm';
import { PUBLIC_PAGE_CENTER_CLASS } from '@/components/app-shell/public-page-layout-classes';

export default function LoginPage() {
  return (
    <div className={PUBLIC_PAGE_CENTER_CLASS}>
      <div className="w-full max-w-md rounded-2xl border border-app-border/90 bg-app-surface p-8 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
        <h1 className="mb-6 text-center text-2xl font-bold text-app-ink">
          Login
        </h1>

        <UserLoginForm />

        <p className="mt-4 text-center text-sm text-app-muted">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="text-app-primary hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
