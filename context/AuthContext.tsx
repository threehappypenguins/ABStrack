// context/AuthContext.tsx
import { AuthService, supabase } from '@/lib/supabase';
import { User } from '@/types';
import React, { createContext, useContext, useEffect, useState } from 'react';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<any>;
  signUp: (email: string, password: string, metadata: any) => Promise<any>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check initial auth state
    checkAuthState();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state changed:', event, session?.user?.id);
        
        if (session?.user) {
          await loadUserProfile(session.user.id);
        } else {
          setUser(null);
        }
        
        setLoading(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const checkAuthState = async () => {
    try {
      const session = await AuthService.getCurrentSession();
      if (session?.user) {
        await loadUserProfile(session.user.id);
      }
    } catch (error) {
      console.error('Auth check error:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadUserProfile = async (userId: string) => {
    try {
      // First try to get profile from profiles table
      const { data: profile, error } = await AuthService.getUserProfile(userId);
      
      if (profile) {
        setUser({
          id: profile.id,
          email: profile.email,
          role: profile.role,
          firstName: profile.first_name,
          lastName: profile.last_name,
          createdAt: profile.created_at,
        });
      } else {
        // Fallback to auth user metadata if profile doesn't exist yet
        const authUser = await AuthService.getCurrentUser();
        if (authUser) {
          setUser({
            id: authUser.id,
            email: authUser.email || '',
            role: authUser.user_metadata?.role || 'patient',
            firstName: authUser.user_metadata?.firstName || '',
            lastName: authUser.user_metadata?.lastName || '',
            createdAt: authUser.created_at,
          });
        }
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  };

  const signIn = async (email: string, password: string) => {
    const result = await AuthService.signIn(email, password);
    if (result.data?.user) {
      await loadUserProfile(result.data.user.id);
    }
    return result;
  };

  const signUp = async (email: string, password: string, metadata: any) => {
    const result = await AuthService.signUp(email, password, metadata);
    // Don't automatically set user here - let the auth state change handler do it
    // This is because the user needs to confirm their email first
    return result;
  };

  const signOut = async () => {
    await AuthService.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};