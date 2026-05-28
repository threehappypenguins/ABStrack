'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useAuth } from '../../lib/auth-provider';
import { PUBLIC_PAGE_CENTER_CLASS } from '@/components/app-shell/public-page-layout-classes';

/**
 * Redirects signed-in users to the dashboard; otherwise renders public landing content.
 *
 * @param props - Props.
 * @param props.children - Server-rendered landing sections.
 * @returns Loading, redirect, or children.
 */
export function LandingAuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && session) {
      router.replace('/dashboard');
    }
  }, [loading, session, router]);

  if (loading) {
    return (
      <div className={PUBLIC_PAGE_CENTER_CLASS}>
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
      <div className={PUBLIC_PAGE_CENTER_CLASS}>
        <div className="text-center">
          <div
            className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-app-primary border-t-transparent"
            aria-hidden
          />
          <p className="text-sm font-medium text-app-muted">
            Redirecting to your dashboard…
          </p>
        </div>
      </div>
    );
  }

  return children;
}
