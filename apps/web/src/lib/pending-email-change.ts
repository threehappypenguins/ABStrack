/**
 * Reads GoTrue `new_email` when an address change awaits confirmation via
 * {@link AbstrackSupabaseClient.auth.updateUser} (Supabase `email_change` template).
 *
 * @param user - Auth user from `getUser()` / session.
 * @returns Normalized pending address, or `null` when none is set.
 */
export function readPendingEmailChange(user: unknown): string | null {
  if (!user || typeof user !== 'object') {
    return null;
  }
  const raw = (user as { new_email?: unknown }).new_email;
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim().toLowerCase();
  return trimmed === '' ? null : trimmed;
}
