/** Session shape exposed to client components via {@link useAuth}. */
export type AuthProviderSession = {
  user: { id: string; email?: string };
} | null;

/**
 * Maps a verified Supabase user from {@link AbstrackSupabaseClient.auth.getUser} to
 * {@link AuthProviderSession}.
 *
 * @param user - Authenticated user from `getUser()`, or `null` when signed out.
 * @returns Context session or `null` when signed out.
 */
export function mapSupabaseUserToAuthContext(
  user: { id: string; email?: string | null } | null | undefined,
): AuthProviderSession {
  if (!user?.id) {
    return null;
  }
  return {
    user: {
      id: user.id,
      email: user.email ?? undefined,
    },
  };
}
