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

/** Minimum password length enforced by GoTrue for sign-up / update flows. */
export const AUTH_PASSWORD_MIN_LENGTH = 8;

/** GoTrue/bcrypt rejects passwords longer than 72 bytes. */
export const AUTH_PASSWORD_MAX_LENGTH = 72;

/**
 * UTF-8 byte length of a password (GoTrue/bcrypt limit is bytes, not JavaScript string length).
 *
 * @param password - Candidate password.
 * @returns Encoded byte length.
 */
export function getAuthPasswordUtf8ByteLength(password: string): number {
  return new TextEncoder().encode(password).length;
}

/**
 * Keeps password input within {@link AUTH_PASSWORD_MAX_LENGTH} UTF-8 bytes.
 *
 * GoTrue hashes passwords with bcrypt, which only uses the first 72 bytes of the
 * password ([Supabase password security](https://supabase.com/docs/guides/auth/password-security)).
 * HTML `maxLength` counts UTF-16 code units, so emoji and other non-ASCII text can exceed
 * the byte limit while still under `maxLength`.
 *
 * Truncation removes whole Unicode code points from the end (via {@link Array.from}),
 * never lone UTF-16 surrogates.
 *
 * @param value - Raw input from a password field.
 * @returns Value truncated to the byte limit when needed.
 */
export function clampAuthPasswordInput(value: string): string {
  if (getAuthPasswordUtf8ByteLength(value) <= AUTH_PASSWORD_MAX_LENGTH) {
    return value;
  }
  const codePoints = Array.from(value);
  while (codePoints.length > 0) {
    const candidate = codePoints.join('');
    if (getAuthPasswordUtf8ByteLength(candidate) <= AUTH_PASSWORD_MAX_LENGTH) {
      return candidate;
    }
    codePoints.pop();
  }
  return '';
}

/**
 * Client-side password rules before `auth.updateUser({ password })`.
 *
 * @param password - Candidate password.
 * @returns User-visible error, or `null` when acceptable.
 */
export function getAuthPasswordValidationError(
  password: string,
): string | null {
  if (password.length < AUTH_PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`;
  }
  if (getAuthPasswordUtf8ByteLength(password) > AUTH_PASSWORD_MAX_LENGTH) {
    return `Password must be no more than ${AUTH_PASSWORD_MAX_LENGTH} bytes.`;
  }
  return null;
}

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
