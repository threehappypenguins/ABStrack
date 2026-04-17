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

import type { AbstrackSupabaseClient, Session } from '@abstrack/supabase';

type PractitionerBrowserClient = AbstrackSupabaseClient;

/**
 * `localStorage` key for the practitioner MFA device-trust bundle. **Bundle holds session
 * secrets** — see module warning.
 */
export const PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY =
  'abstrack.practitioner.mfaTrustBundle.v1';

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

function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Validates JSON parsed from {@link PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY}. Rejects empty
 * tokens, blank `userId`, non-finite `trustedUntilMs` / `expires_at`, and malformed shapes.
 *
 * @param parsed - Value from `JSON.parse`.
 * @returns Whether the object is safe to use as a trust bundle.
 */
function isValidStoredTrustBundle(
  parsed: unknown,
): parsed is PractitionerMfaTrustBundle {
  if (parsed === null || typeof parsed !== 'object') {
    return false;
  }
  const o = parsed as Record<string, unknown>;
  if (
    !isNonEmptyTrimmedString(o['userId']) ||
    !isNonEmptyTrimmedString(o['refresh_token']) ||
    !isNonEmptyTrimmedString(o['access_token'])
  ) {
    return false;
  }
  const trustedUntilMs = o['trustedUntilMs'];
  if (typeof trustedUntilMs !== 'number' || !Number.isFinite(trustedUntilMs)) {
    return false;
  }
  if (o['expires_at'] !== undefined) {
    const exp = o['expires_at'];
    if (typeof exp !== 'number' || !Number.isFinite(exp)) {
      return false;
    }
  }
  return true;
}

/**
 * Removes `sb-*-auth-token` keys from `localStorage` when present. The practitioner browser client
 * uses **`@supabase/ssr` cookie-backed sessions**; ending the session is done with
 * `auth.signOut` or `POST /api/auth/logout`. This sweep still matters because the Supabase client
 * may persist auth-related material under those keys in some cases, and {@link practitionerSignOutEverywhere}
 * pairs it with server logout so nothing session-like is left in browser storage for this origin.
 * Swallows `localStorage` errors (blocked storage, privacy mode, quota).
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

/**
 * Reads the MFA trust bundle from storage. Corrupt, unparseable, or invalid payloads are removed
 * so tokens are not left in `localStorage` indefinitely.
 */
function readBundle(): PractitionerMfaTrustBundle | null {
  if (typeof window === 'undefined') {
    return null;
  }
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
    );
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isValidStoredTrustBundle(parsed)) {
      clearMfaTrustBundle();
      return null;
    }
    return parsed;
  } catch {
    clearMfaTrustBundle();
    return null;
  }
}

/**
 * @param userId - Authenticated user id from the current session, if any.
 * @returns Whether a non-expired MFA device-trust bundle exists for this user (soft sign-out path).
 * Clears stored tokens when the bundle is **expired** or for a **different** user so session
 * material is not left in `localStorage` after trust has lapsed or the account changed.
 */
export function isPractitionerMfaDeviceTrustActive(
  userId: string | undefined,
): boolean {
  if (userId == null || userId === '') {
    return false;
  }
  const bundle = readBundle();
  if (bundle === null) {
    return false;
  }
  if (bundle.userId !== userId) {
    clearMfaTrustBundle();
    return false;
  }
  if (bundle.trustedUntilMs <= Date.now()) {
    clearMfaTrustBundle();
    return false;
  }
  return true;
}

/**
 * Persists refresh/access tokens for a verified MFA session so this browser can restore AAL2
 * within the trust window. **Only call after explicit user opt-in**; see module XSS warning.
 *
 * @param session - Active Supabase session after successful `mfa.verify`.
 * @param trustedUntilMs - Absolute expiry for the trust window (must be finite).
 */
export function saveMfaTrustBundle(
  session: Session,
  trustedUntilMs: number,
): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (!Number.isFinite(trustedUntilMs)) {
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
    window.localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      JSON.stringify(bundle),
    );
  } catch {
    // Blocked or full storage; trust bundle is optional UX — session is already valid in memory.
  }
}

export function clearMfaTrustBundle(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY);
  } catch {
    // Same environments as `readBundle` / theme storage.
  }
}

/**
 * After a failed trust-bundle restore, re-applies the password session’s tokens so the client is
 * not left on a mismatched or half-applied session. If reversion fails or no tokens were
 * captured, signs out.
 *
 * @param supabase - Browser Supabase client.
 * @param preSessionTokens - Refresh/access pair from before `setSession(bundle)`, if any.
 */
async function revertToPreRestoreSession(
  supabase: PractitionerBrowserClient,
  preSessionTokens: { refresh_token: string; access_token: string } | null,
): Promise<void> {
  if (
    preSessionTokens &&
    preSessionTokens.refresh_token !== '' &&
    preSessionTokens.access_token !== ''
  ) {
    const { error } = await supabase.auth.setSession({
      refresh_token: preSessionTokens.refresh_token,
      access_token: preSessionTokens.access_token,
    });
    if (!error) {
      return;
    }
  }
  await supabase.auth.signOut();
}

/**
 * After email/password sign-in, attempts to restore a prior AAL2 session from the trust bundle.
 * If the stored bundle’s `userId` does not match the current password session’s user, clears the
 * bundle and returns (avoids keeping another user’s tokens after account switch).
 * On failure (revoked or expired tokens, **session user mismatch** after restore, assurance error,
 * **getSession error**, **missing session** after a successful `getSession()` call, or session not at
 * **aal2**), clears the bundle and restores the pre-restore
 * password session (or signs out) so the client is not left authenticated as the wrong user. If the
 * **initial** `getSession()` user id does not match `userId`, clears the bundle and **signs out**
 * (there is no safe pre-restore token pair for the expected user).
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
  if (!bundle) {
    return false;
  }
  if (bundle.userId !== userId) {
    clearMfaTrustBundle();
    return false;
  }
  if (bundle.trustedUntilMs <= Date.now()) {
    clearMfaTrustBundle();
    return false;
  }

  const preSessionResult = await supabase.auth.getSession();
  if (preSessionResult.error) {
    clearMfaTrustBundle();
    await revertToPreRestoreSession(supabase, null);
    return false;
  }

  const preRestoreSession = preSessionResult.data.session;

  if (preRestoreSession?.user?.id !== userId) {
    clearMfaTrustBundle();
    await supabase.auth.signOut();
    return false;
  }

  const preSessionTokens =
    preRestoreSession.refresh_token &&
    preRestoreSession.refresh_token !== '' &&
    preRestoreSession.access_token &&
    preRestoreSession.access_token !== ''
      ? {
          refresh_token: preRestoreSession.refresh_token,
          access_token: preRestoreSession.access_token,
        }
      : null;

  const { error } = await supabase.auth.setSession({
    refresh_token: bundle.refresh_token,
    access_token: bundle.access_token,
  });
  if (error) {
    clearMfaTrustBundle();
    await revertToPreRestoreSession(supabase, preSessionTokens);
    return false;
  }

  const afterSetResult = await supabase.auth.getSession();
  if (afterSetResult.error) {
    clearMfaTrustBundle();
    await revertToPreRestoreSession(supabase, preSessionTokens);
    return false;
  }

  const sessionAfterSet = afterSetResult.data.session;
  if (sessionAfterSet?.user?.id == null || sessionAfterSet.user.id !== userId) {
    clearMfaTrustBundle();
    await revertToPreRestoreSession(supabase, preSessionTokens);
    return false;
  }

  const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error) {
    clearMfaTrustBundle();
    await revertToPreRestoreSession(supabase, preSessionTokens);
    return false;
  }
  if (assurance.data.currentLevel !== 'aal2') {
    clearMfaTrustBundle();
    await revertToPreRestoreSession(supabase, preSessionTokens);
    return false;
  }

  const finalSessionResult = await supabase.auth.getSession();
  if (finalSessionResult.error) {
    clearMfaTrustBundle();
    await revertToPreRestoreSession(supabase, preSessionTokens);
    return false;
  }

  const session = finalSessionResult.data.session;
  if (session == null) {
    clearMfaTrustBundle();
    await revertToPreRestoreSession(supabase, preSessionTokens);
    return false;
  }

  saveMfaTrustBundle(session, bundle.trustedUntilMs);

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
 * Signs the user out. If MFA device trust is still valid, ends the browser session with
 * **`auth.signOut({ scope: 'local' })`** so cookie-backed `@supabase/ssr` state is cleared without
 * revoking the refresh token server-side (allows AAL2 restore from the trust bundle on next visit).
 * Otherwise performs a full Supabase sign-out and clears the trust bundle. For a **full** revoke
 * while trust is active, use {@link practitionerSignOutEverywhere} instead.
 *
 * If `auth.signOut` returns an error, falls back to {@link practitionerSignOutEverywhere} in the
 * browser (server logout + form POST) so cookies are not left in an ambiguous state; in
 * non-browser contexts only `console.error` is used (no redirect).
 *
 * Navigation to `/login` via `location.assign` runs only after a successful client sign-out when
 * `window` is present.
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
    const { error: localSignOutError } = await supabase.auth.signOut({
      scope: 'local',
    });
    if (localSignOutError) {
      if (typeof document !== 'undefined') {
        practitionerSignOutEverywhere();
      } else {
        console.error(
          'practitionerSignOut: local sign-out failed; cannot fall back to server logout without a document.',
          localSignOutError,
        );
      }
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.assign('/login');
    }
    return;
  }

  clearMfaTrustBundle();
  const { error: signOutError } = await supabase.auth.signOut();
  if (signOutError) {
    if (typeof document !== 'undefined') {
      practitionerSignOutEverywhere();
    } else {
      console.error(
        'practitionerSignOut: sign-out failed; cannot fall back to server logout without a document.',
        signOutError,
      );
    }
    return;
  }
  if (typeof window !== 'undefined') {
    window.location.assign('/login');
  }
}

export function getTrustedUntilMsAfterVerification(): number {
  return Date.now() + THIRTY_DAYS_MS;
}
