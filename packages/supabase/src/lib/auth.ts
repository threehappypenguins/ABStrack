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

/** Prefer on the server when verifying identity (validates with Auth server). */
export async function getAuthUser(client: AbstrackSupabaseClient) {
  return client.auth.getUser();
}
