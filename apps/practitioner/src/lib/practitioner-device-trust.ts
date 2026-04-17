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
 * **Deploy gate:** Token persistence and restore are **on by default** for expected practitioner login
 * UX. Set `NEXT_PUBLIC_PRACTITIONER_MFA_DEVICE_TRUST` to `false` or `0` to disable the feature (no
 * writes; reads scrub any existing bundle key)—e.g. if you want zero localStorage session material
 * until server-managed trust ships.
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
 * Whether practitioner MFA “trusted device” (localStorage token bundle) is allowed for this build.
 * Defaults to **true** when unset or empty. Set to **`false` or `0`** (case-insensitive) to disable.
 *
 * @returns False when the env var is explicitly `false` or `0`; otherwise true (including unset).
 *
 * **Use bracket access** for this key: `process.env['NEXT_PUBLIC_PRACTITIONER_MFA_DEVICE_TRUST']`.
 * An earlier change to dotted `process.env.NEXT_PUBLIC_…` relied on compile-time inlining; when
 * the flag was missing from the inlining pass (wrong app `.env` path, cache, or first build), the
 * flag read as always-off and the trust read path scrubbed `localStorage` on every read — breaking
 * device trust. Bracket reads resolve like other runtime `NEXT_PUBLIC_*` usage in Next dev.
 */
export function isPractitionerMfaDeviceTrustEnabled(): boolean {
  let raw: string | undefined;
  try {
    raw =
      typeof process !== 'undefined' && process.env != null
        ? process.env['NEXT_PUBLIC_PRACTITIONER_MFA_DEVICE_TRUST']
        : undefined;
  } catch {
    return false;
  }
  if (raw == null || String(raw).trim() === '') {
    return true;
  }
  const v = String(raw).trim().toLowerCase();
  if (v === 'false' || v === '0') {
    return false;
  }
  if (v === 'true' || v === '1') {
    return true;
  }
  return false;
}

/**
 * Serialized trust bundle. **Contains long-lived session secrets** readable by any script on the
 * origin—see module warning.
 */
export type PractitionerMfaTrustBundle = {
  userId: string;
  /**
   * Sign-in email for this account, stored so the login page can refresh from the bundle **before**
   * `signInWithPassword` — a new password grant typically revokes the previous refresh token, so
   * post-password restore would fail without this ordering.
   */
  email?: string;
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
  if (o['email'] !== undefined && !isNonEmptyTrimmedString(o['email'])) {
    return false;
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
  if (!isPractitionerMfaDeviceTrustEnabled()) {
    try {
      window.localStorage.removeItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY);
    } catch {
      // Blocked storage — same as `clearMfaTrustBundle`.
    }
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
 * Reads the MFA trust bundle for callers that need metadata (e.g. `trustedUntilMs`) without
 * duplicating storage logic.
 *
 * @returns Parsed bundle or `null`.
 */
export function readMfaTrustBundle(): PractitionerMfaTrustBundle | null {
  return readBundle();
}

/**
 * Run **before** `signInWithEmailPassword` on the practitioner login form when a stored bundle
 * exists for this sign-in email. A new password grant usually **invalidates** the prior refresh
 * token on the server, so `tryRestoreTrustedMfaSession` **after** password cannot exchange the
 * bundle token. Refreshing from the bundle first establishes AAL2; the caller then verifies the
 * password as usual.
 *
 * Legacy bundles without `email` skip this path and rely on post-password restore (may fail until
 * the user completes MFA once with a fresh save).
 *
 * @param supabase - Browser Supabase client.
 * @param emailForSignIn - Email from the login form (trimmed comparison).
 * @returns `true` if an AAL2 session was established from the bundle and persisted with
 *   `saveMfaTrustBundle`; `false` to continue with password-first sign-in only.
 *
 * On **refresh failure** (revoked/invalid token, empty session), **user mismatch** after a refresh
 * returns a session, or **non-AAL2** assurance, clears the stored bundle **before** `signOut` so
 * wrong or unusable tokens are not kept in storage (and storage is scrubbed even if `signOut`
 * rejects).
 */
export async function refreshTrustedMfaBundleBeforePasswordSignIn(
  supabase: PractitionerBrowserClient,
  emailForSignIn: string,
): Promise<boolean> {
  if (!isPractitionerMfaDeviceTrustEnabled()) {
    return false;
  }
  const bundle = readBundle();
  if (!bundle || bundle.trustedUntilMs <= Date.now()) {
    return false;
  }
  const want = emailForSignIn.trim().toLowerCase();
  const got = bundle.email?.trim().toLowerCase();
  if (!got || got !== want) {
    return false;
  }

  const { data: refreshData, error: refreshError } =
    await supabase.auth.refreshSession({
      refresh_token: bundle.refresh_token,
    });
  if (refreshError || refreshData?.session == null) {
    clearMfaTrustBundle();
    return false;
  }
  if (refreshData.session.user?.id !== bundle.userId) {
    clearMfaTrustBundle();
    await supabase.auth.signOut();
    return false;
  }

  const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error || assurance.data.currentLevel !== 'aal2') {
    clearMfaTrustBundle();
    await supabase.auth.signOut();
    return false;
  }

  saveMfaTrustBundle(refreshData.session, bundle.trustedUntilMs);
  return true;
}

/**
 * Whether a non-expired MFA device-trust bundle exists for this user (soft sign-out path).
 * Clears stored tokens when the bundle is **expired** or for a **different** user so session
 * material is not left in `localStorage` after trust has lapsed or the account changed.
 *
 * @param userId - Authenticated user id from the current session, if any.
 * @returns Whether a non-expired MFA device-trust bundle exists for this user.
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
 * **`user.email` may be missing** on some Supabase session payloads (for example after
 * `refreshSession` / token rotation). In that case, for the **same** `userId`, we **keep** the
 * email already stored in the bundle so {@link refreshTrustedMfaBundleBeforePasswordSignIn} can
 * still match the next sign-in (see Supabase refresh-token rotation docs).
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
  if (!isPractitionerMfaDeviceTrustEnabled()) {
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
  const emailRaw = session.user.email;
  const emailFromSession =
    typeof emailRaw === 'string' && emailRaw.trim() !== ''
      ? emailRaw.trim()
      : undefined;

  const previous = readMfaTrustBundle();
  const email =
    emailFromSession ??
    (previous?.userId === session.user.id &&
    typeof previous.email === 'string' &&
    previous.email.trim() !== ''
      ? previous.email.trim()
      : undefined);

  const bundle: PractitionerMfaTrustBundle = {
    userId: session.user.id,
    ...(email != null ? { email } : {}),
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

/**
 * Call from `onAuthStateChange` when `event === 'TOKEN_REFRESHED'`. Supabase **rotates refresh tokens**; the bundle written at MFA
 * verify time would otherwise go stale, so the next sign-in’s {@link tryRestoreTrustedMfaSession}
 * would fail and clear storage. Only updates the bundle when a trust row still exists for this user,
 * the window has not expired, and **MFA assurance is AAL2** — so password-only (AAL1) sessions never
 * overwrite a prior AAL2 bundle.
 *
 * **`readBundle()` does not drop expired rows** (only validates shape). If the stored bundle’s
 * trust window has ended, or its `userId` does not match the refreshed session, clears the bundle so
 * stale secrets are not retained until another code path runs.
 *
 * @param supabase - Browser Supabase client.
 * @param session - Session from the auth callback (null clears nothing).
 */
export async function syncMfaTrustBundleAfterTokenRefresh(
  supabase: PractitionerBrowserClient,
  session: Session | null,
): Promise<void> {
  if (typeof window === 'undefined' || session?.user?.id == null) {
    return;
  }
  if (!isPractitionerMfaDeviceTrustEnabled()) {
    return;
  }

  const bundle = readBundle();
  if (!bundle) {
    return;
  }
  if (bundle.userId !== session.user.id) {
    clearMfaTrustBundle();
    return;
  }
  if (bundle.trustedUntilMs <= Date.now()) {
    clearMfaTrustBundle();
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

  const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error || assurance.data.currentLevel !== 'aal2') {
    return;
  }

  saveMfaTrustBundle(session, bundle.trustedUntilMs);
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
 * @returns Whether the password session was re-applied (`reverted`) or the client was signed out.
 */
async function revertToPreRestoreSession(
  supabase: PractitionerBrowserClient,
  preSessionTokens: { refresh_token: string; access_token: string } | null,
): Promise<'reverted' | 'signed_out'> {
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
      return 'reverted';
    }
  }
  await supabase.auth.signOut();
  return 'signed_out';
}

/**
 * Clears the trust bundle after a failed apply step, reverts to the password session when possible,
 * and maps {@link revertToPreRestoreSession}’s outcome to the public union.
 */
async function finishFailedBundleRestore(
  supabase: PractitionerBrowserClient,
  preSessionTokens: { refresh_token: string; access_token: string } | null,
): Promise<{ status: 'not_restored' } | { status: 'signed_out' }> {
  clearMfaTrustBundle();
  const revertOutcome = await revertToPreRestoreSession(
    supabase,
    preSessionTokens,
  );
  return revertOutcome === 'reverted'
    ? { status: 'not_restored' }
    : { status: 'signed_out' };
}

/**
 * Outcome of {@link tryRestoreTrustedMfaSession}.
 *
 * - **`restored`**: AAL2 session was re-established from the trust bundle; caller may skip TOTP.
 * - **`not_restored`**: No AAL2 restore (no/expired/invalid bundle, or restore failed but the
 *   password session was re-applied). The user typically remains signed in at AAL1; caller should
 *   continue MFA flow.
 * - **`signed_out`**: Auth state was cleared during failure handling (e.g. unsafe mismatch,
 *   `getSession` error before tokens were captured, or reversion to the password session failed).
 *   Caller must not assume a session.
 */
export type TryRestoreTrustedMfaSessionResult =
  | { status: 'restored' }
  | { status: 'not_restored' }
  | { status: 'signed_out' };

/**
 * After email/password sign-in, attempts to restore a prior AAL2 session from the trust bundle.
 * If the stored bundle’s `userId` does not match the current password session’s user, clears the
 * bundle and returns (avoids keeping another user’s tokens after account switch).
 * Restore uses `auth.refreshSession({ refresh_token })` with the stored refresh token, not
 * `setSession({ access_token, refresh_token })` alone (see implementation comment).
 * On failure (revoked or expired tokens, **session user mismatch** after restore, assurance error,
 * **getSession error**, **missing session** after a successful `getSession()` call, or session not at
 * **aal2**), clears the bundle and restores the pre-restore
 * password session (or signs out) so the client is not left authenticated as the wrong user. If the
 * **initial** `getSession()` user id does not match `userId`, clears the bundle and **signs out**
 * (there is no safe pre-restore token pair for the expected user).
 *
 * @param supabase - Browser Supabase client.
 * @param userId - Authenticated user id from the new password session.
 * @returns Discriminated result — see {@link TryRestoreTrustedMfaSessionResult}.
 */
export async function tryRestoreTrustedMfaSession(
  supabase: PractitionerBrowserClient,
  userId: string,
): Promise<TryRestoreTrustedMfaSessionResult> {
  const bundle = readBundle();
  if (!bundle) {
    return { status: 'not_restored' };
  }
  if (bundle.userId !== userId) {
    clearMfaTrustBundle();
    return { status: 'not_restored' };
  }
  if (bundle.trustedUntilMs <= Date.now()) {
    clearMfaTrustBundle();
    return { status: 'not_restored' };
  }

  const preSessionResult = await supabase.auth.getSession();
  if (preSessionResult.error) {
    clearMfaTrustBundle();
    await revertToPreRestoreSession(supabase, null);
    return { status: 'signed_out' };
  }

  const preRestoreSession = preSessionResult.data.session;

  if (preRestoreSession?.user?.id !== userId) {
    clearMfaTrustBundle();
    await supabase.auth.signOut();
    return { status: 'signed_out' };
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

  /**
   * Always exchange the stored **refresh** token via the refresh endpoint — do not use
   * `setSession({ access_token, refresh_token })` alone: if the access JWT is still within expiry,
   * GoTrue **skips** `_callRefreshToken` and persists the **same** refresh token from the bundle.
   * After normal use, Supabase may have rotated that refresh token, so the stored pair is stale and
   * restore fails (and the bundle was cleared). `refreshSession({ refresh_token })` always refreshes.
   */
  const { data: refreshData, error: refreshError } =
    await supabase.auth.refreshSession({
      refresh_token: bundle.refresh_token,
    });
  if (refreshError || refreshData?.session == null) {
    return finishFailedBundleRestore(supabase, preSessionTokens);
  }

  const sessionAfterRefresh = refreshData.session;
  if (
    sessionAfterRefresh.user?.id == null ||
    sessionAfterRefresh.user.id !== userId
  ) {
    return finishFailedBundleRestore(supabase, preSessionTokens);
  }

  const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance.error) {
    return finishFailedBundleRestore(supabase, preSessionTokens);
  }
  if (assurance.data.currentLevel !== 'aal2') {
    return finishFailedBundleRestore(supabase, preSessionTokens);
  }

  const finalSessionResult = await supabase.auth.getSession();
  if (finalSessionResult.error) {
    return finishFailedBundleRestore(supabase, preSessionTokens);
  }

  const session = finalSessionResult.data.session;
  if (session == null) {
    return finishFailedBundleRestore(supabase, preSessionTokens);
  }

  saveMfaTrustBundle(session, bundle.trustedUntilMs);

  return { status: 'restored' };
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
 * Clears the browser auth session **without** calling GoTrue’s `POST /logout` endpoint.
 *
 * **`signOut({ scope: 'local' })` still revokes the current session’s refresh token on the server**
 * (`GoTrueClient._signOut` → `admin.signOut(jwt, scope)`). The MFA trust bundle stores a copy of
 * that refresh token; if it is revoked, `refreshSession` / restore fails on the next sign-in — the
 * “same issue” loop users saw after “soft” logout.
 *
 * This mirrors the storage half of `GoTrueClient`’s private `_removeSession` (cookie chunks via
 * `@supabase/ssr`), then navigation reloads the app with an empty session while the bundle’s token
 * remains valid until natural expiry or {@link practitionerSignOutEverywhere}.
 *
 * @param supabase - Browser Supabase client (`createBrowserClient`).
 */
async function clearBrowserSessionWithoutServerLogout(
  supabase: PractitionerBrowserClient,
): Promise<void> {
  const auth = supabase.auth as unknown as {
    storage?: { removeItem: (key: string) => Promise<void> };
    storageKey: string;
    userStorage?: { removeItem: (key: string) => Promise<void> };
  };
  const { storage, storageKey, userStorage } = auth;
  if (!storage?.removeItem || !storageKey) {
    throw new Error('Supabase auth storage API unavailable for soft sign-out');
  }
  await storage.removeItem(storageKey);
  await storage.removeItem(`${storageKey}-code-verifier`);
  await storage.removeItem(`${storageKey}-user`);
  if (userStorage?.removeItem) {
    await userStorage.removeItem(`${storageKey}-user`);
  }
}

/**
 * Signs the user out. If MFA device trust is still valid, clears only **browser** session storage
 * (no `POST /logout`) so the refresh token kept in the trust bundle stays valid for the next
 * visit; then navigates to `/login`. Otherwise performs a full Supabase `signOut()` and clears the
 * bundle. For a **full** server revoke while trust is active, use {@link practitionerSignOutEverywhere}.
 *
 * If the soft session clear fails, falls back to {@link practitionerSignOutEverywhere} in the browser.
 *
 * Navigation to `/login` via `location.assign` runs after soft clear or full sign-out when `window`
 * is present.
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
    try {
      await clearBrowserSessionWithoutServerLogout(supabase);
    } catch (err) {
      console.error(
        'practitionerSignOut: soft session clear failed; falling back to full logout',
        err,
      );
      if (typeof document !== 'undefined') {
        practitionerSignOutEverywhere();
      } else {
        console.error(
          'practitionerSignOut: cannot fall back to server logout without a document.',
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
