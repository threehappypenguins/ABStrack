'use client';

import {
  fetchProfileByUserId,
  getVerifiedAuthSession,
  isAuthSessionMissingError,
  parseAbstrackAccessTokenClaims,
  resolvePractitionerAppGate,
  type AbstrackAccessTokenClaims,
  type AbstrackSupabaseClient,
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
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { syncMfaTrustBundleAfterTokenRefresh } from './practitioner-device-trust';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

/** Auth listener event type from the shared Supabase client (no direct `supabase-js` import). */
type AuthStateChangeEvent = Parameters<
  Parameters<AbstrackSupabaseClient['auth']['onAuthStateChange']>[0]
>[0];

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

/** Avoid infinite loading if auth bootstrap never settles. */
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

/** Result of {@link loadVerifiedAuthSessionWithTimeout} for in-memory session updates. */
type VerifiedSessionLoadResult =
  | { action: 'set'; session: Session }
  | { action: 'clear' }
  | { action: 'preserve' };

/**
 * Loads a verified practitioner session with a bounded wait, shared by bootstrap and
 * `onAuthStateChange`. On bootstrap timeout or refresh-token failure, signs out locally.
 *
 * @param client - Browser Supabase client.
 * @returns Whether to set, clear, or preserve the in-memory session (transient verify failures preserve).
 */
async function loadVerifiedAuthSessionWithTimeout(
  client: AbstrackSupabaseClient,
): Promise<VerifiedSessionLoadResult> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('session_bootstrap_timeout'));
      }, SESSION_BOOTSTRAP_TIMEOUT_MS);
    });

    const raceResult = await Promise.race([
      getVerifiedAuthSession(client),
      timeoutPromise,
    ]).catch(async (raceError: unknown) => {
      if (
        raceError instanceof Error &&
        raceError.message === 'session_bootstrap_timeout'
      ) {
        console.warn(
          'Auth session bootstrap timed out; clearing local session',
        );
        await client.auth.signOut();
        return { action: 'clear' as const };
      }
      throw raceError;
    });

    if (
      typeof raceResult === 'object' &&
      raceResult !== null &&
      'action' in raceResult
    ) {
      return raceResult;
    }

    const {
      data: { session: nextSession },
      error,
    } = raceResult;

    if (error) {
      if (!isAuthSessionMissingError(error)) {
        console.error('Failed to verify practitioner auth session', error);
      }
      if (isRefreshTokenFailure(error)) {
        await client.auth.signOut();
        return { action: 'clear' };
      }
      return { action: 'preserve' };
    }

    if (nextSession) {
      return { action: 'set', session: nextSession };
    }

    // Verified signed out (`getVerifiedAuthSession`: no user / no session, no error).
    return { action: 'clear' };
  } catch (error) {
    if (!isAuthSessionMissingError(error)) {
      console.error('Failed to verify practitioner auth session', error);
    }
    if (isRefreshTokenFailure(error)) {
      await client.auth.signOut();
      return { action: 'clear' };
    }
    return { action: 'preserve' };
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
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
  /** Drops stale verify completions after newer auth events or unmount. */
  const verifyGenerationRef = useRef(0);

  useEffect(() => {
    let mounted = true;

    const syncVerifiedSession = async (
      event?: AuthStateChangeEvent,
    ): Promise<void> => {
      const generation = ++verifyGenerationRef.current;
      try {
        const loadResult = await loadVerifiedAuthSessionWithTimeout(supabase);
        if (!mounted || generation !== verifyGenerationRef.current) {
          return;
        }
        if (loadResult.action === 'set') {
          setSession(loadResult.session);
          if (event === 'TOKEN_REFRESHED') {
            try {
              await syncMfaTrustBundleAfterTokenRefresh(
                supabase,
                loadResult.session,
              );
            } catch (trustError) {
              console.error(
                'Failed to sync MFA trust bundle after token refresh',
                trustError,
              );
            }
          }
        } else if (loadResult.action === 'clear') {
          setSession(null);
        }
      } catch (error) {
        console.error('Failed to handle practitioner auth state change', error);
        if (isRefreshTokenFailure(error)) {
          await supabase.auth.signOut();
          if (mounted && generation === verifyGenerationRef.current) {
            setSession(null);
          }
        }
      }
    };

    const initializeAuth = async () => {
      try {
        await syncVerifiedSession();
      } finally {
        if (mounted) {
          setAuthLoading(false);
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
        return;
      }
      void syncVerifiedSession(event);
    });

    return () => {
      mounted = false;
      verifyGenerationRef.current += 1;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const pendingInviteMetadataId =
    typeof session?.user?.user_metadata?.abstrack_practitioner_invite_id ===
    'string'
      ? session.user.user_metadata.abstrack_practitioner_invite_id.trim()
      : '';

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
      if (data != null) {
        setProfile(data);
        return;
      }
      if (pendingInviteMetadataId !== '') {
        // Finalize runs on `/invite/join`; keep loading until profile exists.
        setProfile(undefined);
        return;
      }
      const { data: retry, error: retryErr } = await fetchProfileByUserId(
        supabase,
        userId,
      );
      if (cancelled) {
        return;
      }
      if (retryErr) {
        const err =
          retryErr instanceof Error
            ? retryErr
            : new Error(
                typeof retryErr === 'object' &&
                retryErr !== null &&
                'message' in retryErr &&
                typeof (retryErr as { message: unknown }).message === 'string'
                  ? (retryErr as { message: string }).message
                  : 'Profile request failed',
              );
        setProfileError(err);
        setProfile(null);
        return;
      }
      setProfile(retry ?? null);
    };

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [
    session?.user?.id,
    session?.access_token,
    pendingInviteMetadataId,
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
