import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';
import { getSupabaseUrl } from './env-public.js';

/**
 * Server-only **secret** API key (`sb_secret_...` from Project Settings → API Keys).
 * Named for what you configure (`SUPABASE_SECRET_KEY`), not the old JWT `service_role` env name.
 * Per [Supabase API keys](https://supabase.com/docs/guides/api/api-keys), use publishable + secret keys;
 * legacy JWT service_role keys are not read here. Never import this module from client code.
 */
export function getSupabaseSecretKey(): string {
  const key =
    typeof process !== 'undefined' && process.env
      ? process.env.SUPABASE_SECRET_KEY
      : undefined;
  if (!key) {
    throw new Error(
      'Missing SUPABASE_SECRET_KEY (server-only). Set the secret key from Project Settings → API Keys.',
    );
  }
  return key;
}

/**
 * Supabase client using the **secret** key — bypasses RLS (same privilege level as classic “service role”).
 * Use only in trusted server jobs, migrations tooling, or audited admin routes.
 */
export function getSupabaseAdminClient() {
  return createClient<Database>(getSupabaseUrl(), getSupabaseSecretKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
