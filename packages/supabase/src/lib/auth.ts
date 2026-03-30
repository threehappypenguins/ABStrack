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

export async function getSession(client: AbstrackSupabaseClient) {
  return client.auth.getSession();
}

/** Prefer on the server when verifying identity (validates with Auth server). */
export async function getAuthUser(client: AbstrackSupabaseClient) {
  return client.auth.getUser();
}
