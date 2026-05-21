import type { Session, User } from '@supabase/supabase-js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

export type { AbstrackSupabaseClient };

export async function signInWithEmailPassword(
  client: AbstrackSupabaseClient,
  email: string,
  password: string,
) {
  return client.auth.signInWithPassword({ email, password });
}

export async function signUpWithEmailPassword(
  client: AbstrackSupabaseClient,
  email: string,
  password: string,
  options?: {
    emailRedirectTo?: string;
    data?: Record<string, unknown>;
  },
) {
  return client.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: options?.emailRedirectTo,
      data: options?.data,
    },
  });
}

export async function signOut(client: AbstrackSupabaseClient) {
  return client.auth.signOut();
}

export async function resetPasswordForEmail(
  client: AbstrackSupabaseClient,
  email: string,
  optionsOrRedirectTo?:
    | string
    | {
        redirectTo?: string;
        captchaToken?: string;
      },
) {
  const options =
    typeof optionsOrRedirectTo === 'string'
      ? { redirectTo: optionsOrRedirectTo }
      : optionsOrRedirectTo;

  return client.auth.resetPasswordForEmail(email, {
    redirectTo: options?.redirectTo,
    captchaToken: options?.captchaToken,
  });
}

export async function updateUserPassword(
  client: AbstrackSupabaseClient,
  password: string,
) {
  return client.auth.updateUser({ password });
}

export async function updatePassword(
  client: AbstrackSupabaseClient,
  password: string,
) {
  return updateUserPassword(client, password);
}

export async function getSession(client: AbstrackSupabaseClient) {
  return client.auth.getSession();
}

/** Prefer when verifying identity (validates with the Auth server). */
export async function getAuthUser(client: AbstrackSupabaseClient) {
  return client.auth.getUser();
}

/**
 * Returns a trimmed access token from persisted session storage only.
 * Does not read `session.user` (avoids Supabase insecure-user warnings).
 *
 * @param client - Supabase client.
 * @returns Access token or `null` when missing or on error.
 */
export async function getAccessTokenFromSession(
  client: AbstrackSupabaseClient,
): Promise<{ accessToken: string | null; error: Error | null }> {
  const { data, error } = await client.auth.getSession();
  if (error) {
    return { accessToken: null, error };
  }
  const token = data.session?.access_token?.trim();
  return {
    accessToken: token && token.length > 0 ? token : null,
    error: null,
  };
}

/**
 * Loads persisted session tokens and attaches a **verified** `user` from {@link getAuthUser}.
 * Use instead of trusting `getSession().data.session.user` alone.
 *
 * @param client - Supabase client.
 * @returns Verified user, session (with verified user), and any error.
 */
export async function getVerifiedAuthSession(
  client: AbstrackSupabaseClient,
): Promise<{
  data: { user: User | null; session: Session | null };
  error: Error | null;
}> {
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) {
    return { data: { user: null, session: null }, error: userError };
  }
  const user = userData.user;
  if (!user) {
    return { data: { user: null, session: null }, error: null };
  }

  const { data: sessionData, error: sessionError } =
    await client.auth.getSession();
  if (sessionError) {
    return { data: { user: null, session: null }, error: sessionError };
  }

  const persisted = sessionData.session;
  if (!persisted) {
    return { data: { user, session: null }, error: null };
  }

  return {
    data: { user, session: { ...persisted, user } },
    error: null,
  };
}
