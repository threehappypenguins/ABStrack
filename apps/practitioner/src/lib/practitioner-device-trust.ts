/**
 * Practitioner MFA “trusted device” helpers — **browser `localStorage` only**.
 *
 * **XSS / token exposure (high impact on patient-data surfaces):** When the user opts in after
 * successful TOTP verification, we persist a JSON bundle that includes Supabase **`refresh_token`**
 * and **`access_token`**. Any successful XSS in this origin can read `localStorage`, exfiltrate those
 * secrets, and mint sessions until tokens expire or are revoked—materially larger blast radius than
 * the default Supabase session key alone.
 *
 * **Operational mitigations (required, not sufficient):** Ship a **strict Content-Security-Policy**
 * (e.g. at the CDN / edge / host; include `connect-src` for your Supabase project and websocket
 * endpoints), avoid inline script injection (`dangerouslySetInnerHTML`, unsanitized HTML), keep
 * dependencies patched, and treat XSS prevention as part of the security boundary for this
 * feature.
 *
 * **Preferred direction:** Replace this pattern with **server-managed** device trust (e.g.
 * HttpOnly, `Secure`, `SameSite` cookie holding an opaque device id + server-side validation, or a
 * short-lived scoped token exchanged only on the server). Documented at repo level in
 * `docs/SECURITY_BASELINE.md`.
 *
 * RLS and MFA fail-closed rules remain authoritative for PHI; this module is UX-only.
 *
 * @module practitioner-device-trust
 */

import type { Session } from '@abstrack/supabase';
import type { getSupabaseBrowserClient } from '@abstrack/supabase/browser';

type PractitionerBrowserClient = ReturnType<typeof getSupabaseBrowserClient>;

const MFA_TRUST_KEY = 'abstrack.practitioner.mfaTrustBundle.v1';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Serialized trust bundle. **Contains long-lived session secrets** readable by any script on the
 * origin—see module warning.
 */
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
 * Swallows `localStorage` errors (blocked storage, privacy mode, quota) so sign-out still proceeds.
 */
export function clearSupabaseBrowserAuthStorage(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
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
  } catch {
    // `localStorage` can throw when blocked or in some privacy modes (see `theme-storage.ts`).
  }
}

function readBundle(): PractitionerMfaTrustBundle | null {
  if (typeof window === 'undefined') {
    return null;
  }
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(MFA_TRUST_KEY);
  } catch {
    return null;
  }
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
 * @param userId - Authenticated user id from the current session, if any.
 * @returns Whether a non-expired MFA device-trust bundle exists for this user (soft sign-out path).
 */
export function isPractitionerMfaDeviceTrustActive(
  userId: string | undefined,
): boolean {
  if (userId == null || userId === '') {
    return false;
  }
  const bundle = readBundle();
  return (
    bundle !== null &&
    bundle.userId === userId &&
    bundle.trustedUntilMs > Date.now()
  );
}

/**
 * Persists refresh/access tokens for a verified MFA session so this browser can restore AAL2
 * within the trust window. **Only call after explicit user opt-in**; see module XSS warning.
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
  try {
    window.localStorage.setItem(MFA_TRUST_KEY, JSON.stringify(bundle));
  } catch {
    // Blocked or full storage; trust bundle is optional UX — session is already valid in memory.
  }
}

export function clearMfaTrustBundle(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(MFA_TRUST_KEY);
  } catch {
    // Same environments as `readBundle` / theme storage.
  }
}

/**
 * After email/password sign-in, attempts to restore a prior AAL2 session from the trust bundle.
 * On failure (revoked or expired tokens, **session user mismatch** after restore, assurance error,
 * or session not at **aal2**), clears the bundle so later logins do not repeat a useless restore.
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

  const {
    data: { session: sessionAfterSet },
  } = await supabase.auth.getSession();
  if (sessionAfterSet?.user?.id == null || sessionAfterSet.user.id !== userId) {
    clearMfaTrustBundle();
    return false;
  }

  const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error) {
    clearMfaTrustBundle();
    return false;
  }
  if (assurance.data.currentLevel !== 'aal2') {
    clearMfaTrustBundle();
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
 * Full sign-out: clears the MFA trust bundle and browser `sb-*` auth storage, then POSTs to
 * `/api/auth/logout` so the server revokes refresh tokens and clears auth cookies. Prefer this on
 * shared machines, after credential compromise, or whenever all sessions must end. Navigation happens
 * via the redirect response (this function does not return in normal browsers).
 */
export function practitionerSignOutEverywhere(): void {
  if (typeof document === 'undefined') {
    return;
  }
  clearMfaTrustBundle();
  try {
    clearSupabaseBrowserAuthStorage();
  } catch {
    // ignore
  }
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/api/auth/logout';
  form.setAttribute('aria-hidden', 'true');
  form.style.display = 'none';
  document.body.appendChild(form);
  form.submit();
}

/**
 * Signs the user out. If MFA device trust is still valid, clears only local Supabase storage so the
 * refresh token is not revoked server-side (allows AAL2 restore on next visit). Otherwise performs
 * a full Supabase sign-out and clears the trust bundle. For a **full** revoke while trust is active,
 * use {@link practitionerSignOutEverywhere} instead.
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
