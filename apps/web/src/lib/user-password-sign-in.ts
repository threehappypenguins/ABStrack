/** `auth.users` metadata: set when a password is saved on user web (settings or `/update-password`). */
export const USER_PASSWORD_SET_USER_METADATA_KEY = 'abstrack_password_set';

type UserMetadataCarrier = {
  user_metadata?: Record<string, unknown> | null;
};

/**
 * True when this user saved a password (sign-up, settings, or password reset).
 * Magic-link–only accounts omit this flag.
 *
 * @param user - Supabase Auth user (session or `getUser()`).
 * @returns Whether email/password sign-in is enabled for this account.
 */
export function userHasPasswordSignIn(
  user: UserMetadataCarrier | null | undefined,
): boolean {
  const raw = user?.user_metadata?.[USER_PASSWORD_SET_USER_METADATA_KEY];
  return raw === true || raw === 'true';
}

/**
 * Builds a cryptographically random password for revoking user-chosen credentials
 * while keeping the account active for magic-link sign-in.
 *
 * @returns A password string suitable for `updateUser({ password })`.
 */
export function buildRevokedPasswordPlaceholder(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const segment = Array.from(bytes, (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  return `Abstrack-revoked-${segment}!9`;
}
