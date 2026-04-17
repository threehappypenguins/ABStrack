import type { Session } from '@abstrack/supabase';
import type { getSupabaseBrowserClient } from '@abstrack/supabase/browser';

type PractitionerBrowserClient = ReturnType<typeof getSupabaseBrowserClient>;

const MFA_TRUST_KEY = 'abstrack.practitioner.mfaTrustBundle.v1';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export type PractitionerMfaTrustBundle = {
  userId: string;
  refresh_token: string;
  access_token: string;
  expires_at?: number;
  /** Wall-clock time after which we stop attempting session restore (user must enter TOTP again). */
  trustedUntilMs: number;
};

/**
 * Removes persisted Supabase browser session keys without calling Auth sign-out (no server-side
 * refresh revocation). Used for “trusted device” sign-out so the next sign-in can restore AAL2.
 */
export function clearSupabaseBrowserAuthStorage(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
      toRemove.push(key);
    }
  }
  for (const key of toRemove) {
    localStorage.removeItem(key);
  }
}

function readBundle(): PractitionerMfaTrustBundle | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = window.localStorage.getItem(MFA_TRUST_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as PractitionerMfaTrustBundle;
    if (
      typeof parsed.userId === 'string' &&
      typeof parsed.refresh_token === 'string' &&
      typeof parsed.access_token === 'string' &&
      typeof parsed.trustedUntilMs === 'number'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persists refresh/access tokens for a verified MFA session so this browser can restore AAL2
 * within the trust window. Sensitive: only call when the user opted in.
 *
 * @param session - Active Supabase session after successful `mfa.verify`.
 * @param trustedUntilMs - Absolute expiry for the trust window.
 */
export function saveMfaTrustBundle(
  session: Session,
  trustedUntilMs: number,
): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (
    session.refresh_token == null ||
    session.refresh_token === '' ||
    session.access_token == null ||
    session.access_token === ''
  ) {
    return;
  }
  const bundle: PractitionerMfaTrustBundle = {
    userId: session.user.id,
    refresh_token: session.refresh_token,
    access_token: session.access_token,
    expires_at: session.expires_at,
    trustedUntilMs,
  };
  window.localStorage.setItem(MFA_TRUST_KEY, JSON.stringify(bundle));
}

export function clearMfaTrustBundle(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(MFA_TRUST_KEY);
}

/**
 * After email/password sign-in, attempts to restore a prior AAL2 session from the trust bundle.
 * On failure (revoked or expired), clears the bundle.
 *
 * @param supabase - Browser Supabase client.
 * @param userId - Authenticated user id from the new password session.
 * @returns Whether navigation to patient routes should skip the TOTP step.
 */
export async function tryRestoreTrustedMfaSession(
  supabase: PractitionerBrowserClient,
  userId: string,
): Promise<boolean> {
  const bundle = readBundle();
  if (!bundle || bundle.userId !== userId) {
    return false;
  }
  if (bundle.trustedUntilMs <= Date.now()) {
    clearMfaTrustBundle();
    return false;
  }

  const { error } = await supabase.auth.setSession({
    refresh_token: bundle.refresh_token,
    access_token: bundle.access_token,
  });
  if (error) {
    clearMfaTrustBundle();
    return false;
  }

  const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error) {
    return false;
  }
  if (assurance.data.currentLevel !== 'aal2') {
    return false;
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (session) {
    saveMfaTrustBundle(session, bundle.trustedUntilMs);
  }

  return true;
}

/**
 * Signs the user out. If MFA device trust is still valid, clears only local Supabase storage so the
 * refresh token is not revoked server-side (allows AAL2 restore on next visit). Otherwise performs
 * a full Supabase sign-out and clears the trust bundle.
 *
 * @param supabase - Browser Supabase client.
 */
export async function practitionerSignOut(
  supabase: PractitionerBrowserClient,
): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  const bundle = readBundle();
  const trustActiveForUser =
    session &&
    bundle &&
    bundle.userId === session.user.id &&
    bundle.trustedUntilMs > Date.now();

  if (trustActiveForUser) {
    clearSupabaseBrowserAuthStorage();
    window.location.assign('/login');
    return;
  }

  clearMfaTrustBundle();
  await supabase.auth.signOut();
  window.location.assign('/login');
}

export function getTrustedUntilMsAfterVerification(): number {
  return Date.now() + THIRTY_DAYS_MS;
}
