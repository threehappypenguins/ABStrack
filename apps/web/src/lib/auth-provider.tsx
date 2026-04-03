'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { createBrowserClient } from './supabase/browser-client';

interface AuthContextType {
  session: { user: { id: string; email?: string } } | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthContextType['session']>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const supabase = createBrowserClient();

    // Get initial session and always clear loading, even on failure.
    const initializeSession = async () => {
      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();

        if (error) {
          console.error('Failed to load auth session', error);
          if (mounted) {
            setSession(null);
          }
          return;
        }

        if (mounted) {
          setSession(session);
        }
      } catch (error) {
        console.error('Failed to load auth session', error);
      } finally {
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
