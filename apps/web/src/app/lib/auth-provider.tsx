'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@/lib/supabase/browser-client';

/**
 * AuthProvider: Listens for auth state changes and syncs UI accordingly.
 * Handles SIGNED_IN, SIGNED_OUT, and TOKEN_REFRESHED events.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createBrowserClient();

    // Set up auth state change listener
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        router.refresh();
      }

      if (event === 'SIGNED_OUT') {
        router.replace('/login');
      }

      if (event === 'TOKEN_REFRESHED') {
        router.refresh();
      }
    });

    // Cleanup subscription on unmount
    return () => {
      subscription?.unsubscribe();
    };
  }, [router]);

  return <>{children}</>;
}
