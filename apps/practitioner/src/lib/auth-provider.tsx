'use client';

import {
  fetchProfileByUserId,
  parseAbstrackAccessTokenClaims,
  resolvePractitionerAppGate,
  type AbstrackAccessTokenClaims,
  type Database,
  type PractitionerAppGate,
  type Session,
} from '@abstrack/supabase';
import { getSupabaseBrowserClient } from '@abstrack/supabase/browser';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { syncMfaTrustBundleAfterTokenRefresh } from './practitioner-device-trust';
import { completePractitionerInviteAfterAuth } from './practitioner-invite-complete';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

interface AuthContextType {
  session: Session | null;
  /**
   * True while initial auth is resolving or, when signed in, while the profile row is loading.
   */
  loading: boolean;
  /** Own profile row: undefined = not loaded yet; null = no row or load failed without error object. */
  profile: ProfileRow | null | undefined;
  profileError: Error | null;
  /** Claims from the current access token (signature not verified locally). */
  accessTokenClaims: AbstrackAccessTokenClaims | null;
  /** Normalized gate for practitioner routing (role from DB, MFA from JWT `aal`). */
  gate: PractitionerAppGate;
}

const AuthContext = createContext<AuthContextType | null>(null);

/** Avoid infinite loading if `getSession` never settles. */
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

/**
 * Provides practitioner auth session state, `profiles.app_role`, and JWT claim metadata from
 * Supabase browser auth. See `docs/AUTH_CLAIM_CONTRACT.md`.
 *
 * @param props - Wrapper props.
 * @returns Context provider with session, profile, and loading state.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileRow | null | undefined>(
    undefined,
  );
  const [profileError, setProfileError] = useState<Error | null>(null);

  const accessTokenClaims = useMemo(
    () => parseAbstrackAccessTokenClaims(session?.access_token),
    [session?.access_token],
  );

  const gate = useMemo(
    () =>
      resolvePractitionerAppGate({
        hasSession: Boolean(session?.user),
        profile,
        profileError,
        accessTokenClaims,
      }),
    [session?.user, profile, profileError, accessTokenClaims],
  );

  const identityLoading =
    Boolean(session?.user) && profile === undefined && profileError === null;

  const loading = authLoading || identityLoading;

  useEffect(() => {
    let mounted = true;

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
          console.error('Failed to load practitioner auth session', error);
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
        console.error('Failed to load practitioner auth session', error);
        if (isRefreshTokenFailure(error)) {
          await supabase.auth.signOut();
        }
      } finally {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        if (mounted) {
          setAuthLoading(false);
        }
      }
    };

    void initializeSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === 'TOKEN_REFRESHED') {
        void syncMfaTrustBundleAfterTokenRefresh(supabase, nextSession);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) {
      setProfile(undefined);
      setProfileError(null);
      return;
    }

    let cancelled = false;

    const loadProfile = async () => {
      setProfile(undefined);
      setProfileError(null);
      const { data, error } = await fetchProfileByUserId(supabase, userId);
      if (cancelled) {
        return;
      }
      if (error) {
        const err =
          error instanceof Error
            ? error
            : new Error(
                typeof error === 'object' &&
                error !== null &&
                'message' in error &&
                typeof (error as { message: unknown }).message === 'string'
                  ? (error as { message: string }).message
                  : 'Profile request failed',
              );
        setProfileError(err);
        setProfile(null);
        return;
      }
      setProfile(data ?? null);
    };

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, supabase]);

  const practitionerInviteId =
    typeof session?.user?.user_metadata?.abstrack_practitioner_invite_id ===
    'string'
      ? session.user.user_metadata.abstrack_practitioner_invite_id.trim()
      : '';

  /**
   * When **`user_metadata.abstrack_practitioner_invite_id`** is set, completes the patient invite
   * once. The Edge function clears that metadata on success; **`refreshSession`** loads the updated
   * JWT so this effect does not repeat finalize on every app load.
   */
  useEffect(() => {
    const token = session?.access_token?.trim();
    const userId = session?.user?.id;
    if (!token || !practitionerInviteId || !userId) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const result = await completePractitionerInviteAfterAuth(
        token,
        practitionerInviteId,
      );
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        console.warn('Practitioner invite finalize:', result.message);
        return;
      }
      const { error: refreshErr } = await supabase.auth.refreshSession();
      if (refreshErr) {
        console.warn(
          'Practitioner invite finalize: refreshSession after clearing invite metadata',
          refreshErr,
        );
      }
      const { data, error } = await fetchProfileByUserId(supabase, userId);
      if (cancelled) {
        return;
      }
      if (error) {
        setProfileError(
          error instanceof Error
            ? error
            : new Error('Profile refresh failed after invite'),
        );
        setProfile(null);
        return;
      }
      setProfile(data ?? null);
      setProfileError(null);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    session?.access_token,
    practitionerInviteId,
    session?.user?.id,
    supabase,
  ]);

  const value = useMemo(
    () => ({
      session,
      loading,
      profile,
      profileError,
      accessTokenClaims,
      gate,
    }),
    [session, loading, profile, profileError, accessTokenClaims, gate],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Reads practitioner auth context.
 *
 * @returns Auth context.
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
