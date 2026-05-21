/** Session shape exposed to client components via {@link useAuth}. */
export type AuthProviderSession = {
  user: { id: string; email?: string };
} | null;

/**
 * Maps a Supabase session from the server client to {@link AuthProviderSession}.
 *
 * @param session - Result of `supabase.auth.getSession()` on the server.
 * @returns Context session or `null` when signed out.
 */
export function mapSupabaseSessionToAuthContext(
  session: { user: { id: string; email?: string | null } } | null,
): AuthProviderSession {
  if (!session?.user?.id) {
    return null;
  }
  return {
    user: {
      id: session.user.id,
      email: session.user.email ?? undefined,
    },
  };
}
