'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  type AuthProviderSession,
  mapSupabaseUserToAuthContext,
} from './auth-provider-session';
import { createBrowserClient } from './supabase/browser-client';

export type { AuthProviderSession } from './auth-provider-session';

interface AuthContextType {
  session: AuthProviderSession;
  loading: boolean;
}

export type AuthProviderProps = {
  children: React.ReactNode;
  /**
   * Server-hydrated session from the root layout. When provided (including `null`),
   * `loading` starts `false` so authenticated private routes can render app chrome on
   * first paint without waiting for client `getUser`.
   */
  initialSession?: AuthProviderSession | null;
};

const AuthContext = createContext<AuthContextType | null>(null);

/** Avoid infinite loading if `getUser` never settles (e.g. bad refresh cookie edge cases). */
const SESSION_BOOTSTRAP_TIMEOUT_MS = 8_000;

function isRefreshTokenFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const e = error as { code?: string; message?: string };
  if (e.code === 'refresh_token_not_found') {
    return true;
  }
  if (
    typeof e.message === 'string' &&
    /refresh token/i.test(e.message) &&
    /invalid|not found|revoked|expired/i.test(e.message)
  ) {
    return true;
  }
  return false;
}

export function AuthProvider({ children, initialSession }: AuthProviderProps) {
  const hasInitialSession = initialSession !== undefined;
  const [session, setSession] = useState<AuthProviderSession>(
    hasInitialSession ? initialSession : null,
  );
  const [loading, setLoading] = useState(!hasInitialSession);
  /** Drops stale verify completions after newer auth events or unmount. */
  const verifyGenerationRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    const supabase = createBrowserClient();

    const syncVerifiedUser = async (): Promise<void> => {
      const generation = ++verifyGenerationRef.current;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error('session_bootstrap_timeout'));
          }, SESSION_BOOTSTRAP_TIMEOUT_MS);
        });

        const result = await Promise.race([
          supabase.auth.getUser(),
          timeoutPromise,
        ]).catch(async (raceError: unknown) => {
          if (
            raceError instanceof Error &&
            raceError.message === 'session_bootstrap_timeout'
          ) {
            console.warn(
              'Auth user bootstrap timed out; keeping in-memory session',
            );
            return null;
          }
          throw raceError;
        });

        if (result === null) {
          return;
        }

        const {
          data: { user },
          error,
        } = result;

        if (error) {
          console.error('Failed to verify authenticated user', error);
          if (isRefreshTokenFailure(error)) {
            await supabase.auth.signOut();
            if (mounted && generation === verifyGenerationRef.current) {
              setSession(null);
            }
          }
          return;
        }

        if (mounted && generation === verifyGenerationRef.current) {
          setSession(mapSupabaseUserToAuthContext(user));
        }
      } catch (error) {
        console.error('Failed to verify authenticated user', error);
        if (isRefreshTokenFailure(error)) {
          await supabase.auth.signOut();
          if (mounted && generation === verifyGenerationRef.current) {
            setSession(null);
          }
        }
      } finally {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }
    };

    const initializeAuth = async () => {
      try {
        await syncVerifiedUser();
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        verifyGenerationRef.current += 1;
        if (mounted) {
          setSession(null);
        }
      }
      void syncVerifiedUser();
    });

    return () => {
      mounted = false;
      verifyGenerationRef.current += 1;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
