'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { createBrowserClient } from './supabase/browser-client';

interface AuthContextType {
  session: { user: { id: string; email?: string } } | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

/** Avoid infinite loading if `getSession` never settles (e.g. bad refresh cookie edge cases). */
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthContextType['session']>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const supabase = createBrowserClient();

    // Get initial session and always clear loading, even on failure.
    const initializeSession = async () => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error('session_bootstrap_timeout'));
          }, SESSION_BOOTSTRAP_TIMEOUT_MS);
        });

        const {
          data: { session: nextSession },
          error,
        } = await Promise.race([
          supabase.auth.getSession(),
          timeoutPromise,
        ]).catch(async (raceError: unknown) => {
          if (
            raceError instanceof Error &&
            raceError.message === 'session_bootstrap_timeout'
          ) {
            console.warn(
              'Auth session bootstrap timed out; clearing local session',
            );
            await supabase.auth.signOut();
            return { data: { session: null }, error: null };
          }
          throw raceError;
        });

        if (error) {
          console.error('Failed to load auth session', error);
          if (isRefreshTokenFailure(error)) {
            await supabase.auth.signOut();
          }
          if (mounted) {
            setSession(null);
          }
          return;
        }

        if (mounted) {
          setSession(nextSession);
        }
      } catch (error) {
        console.error('Failed to load auth session', error);
        if (isRefreshTokenFailure(error)) {
          await supabase.auth.signOut();
        }
      } finally {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void initializeSession();

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => {
      mounted = false;
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
