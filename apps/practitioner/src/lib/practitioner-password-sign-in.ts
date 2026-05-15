/** `auth.users` metadata: set when a password is saved on `/update-password` (TOTP required for PHI). */
export const PRACTITIONER_PASSWORD_SET_USER_METADATA_KEY =
  'abstrack_practitioner_password_set';

type UserMetadataCarrier = {
  user_metadata?: Record<string, unknown> | null;
};

/**
 * True when this practitioner saved a password (invite optional flow or password reset).
 * Magic-link–only invitees omit this flag and are not required to enroll TOTP.
 *
 * @param user - Supabase Auth user (session or `getUser()`).
 */
export function practitionerUserHasPasswordSignIn(
  user: UserMetadataCarrier | null | undefined,
): boolean {
  const raw =
    user?.user_metadata?.[PRACTITIONER_PASSWORD_SET_USER_METADATA_KEY];
  return raw === true || raw === 'true';
}
