/** `auth.users` metadata: set when a password is saved on user web (settings or `/update-password`). */
export const USER_PASSWORD_SET_USER_METADATA_KEY = 'abstrack_password_set';

type UserMetadataCarrier = {
  user_metadata?: Record<string, unknown> | null;
};

/**
 * True when this user saved a password (sign-up, settings, or password reset).
 * Magic-link–only accounts omit this flag unless explicitly revoked (`false`).
 *
 * @param user - Supabase Auth user (session or `getUser()`).
 * @returns Whether email/password sign-in is enabled for this account.
 */
export function userHasPasswordSignIn(
  user: UserMetadataCarrier | null | undefined,
): boolean {
  const raw = user?.user_metadata?.[USER_PASSWORD_SET_USER_METADATA_KEY];
  if (raw === false || raw === 'false') {
    return false;
  }
  return raw === true || raw === 'true';
}

/** GoTrue/bcrypt rejects passwords longer than 72 bytes. */
export const AUTH_PASSWORD_MAX_LENGTH = 72;

const REVOKED_PASSWORD_PREFIX = 'Abstrack-revoked-';
const REVOKED_PASSWORD_SUFFIX = '!9';

/**
 * Builds a cryptographically random password for revoking user-chosen credentials
 * while keeping the account active for magic-link sign-in.
 *
 * Length stays within {@link AUTH_PASSWORD_MAX_LENGTH} (bcrypt limit).
 *
 * @returns A password string suitable for `updateUser({ password })`.
 */
export function buildRevokedPasswordPlaceholder(): string {
  const fixedLength =
    REVOKED_PASSWORD_PREFIX.length + REVOKED_PASSWORD_SUFFIX.length;
  const maxRandomChars = AUTH_PASSWORD_MAX_LENGTH - fixedLength;
  const randomByteCount = Math.floor(maxRandomChars / 2);

  const bytes = new Uint8Array(randomByteCount);
  crypto.getRandomValues(bytes);
  const segment = Array.from(bytes, (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  return `${REVOKED_PASSWORD_PREFIX}${segment}${REVOKED_PASSWORD_SUFFIX}`;
}
