import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';
import { getSupabaseUrl } from './env-public.js';

/**
 * Server-only **secret** API key (`sb_secret_...` from the dashboard).
 * Per [Supabase API keys](https://supabase.com/docs/guides/api/api-keys), use publishable + secret keys;
 * this package does not read legacy JWT `service_role` env vars. Never import this module from client code.
 */
export function getSupabaseServiceRoleKey(): string {
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
 * Bypasses RLS — use only in trusted server jobs, migrations tooling, or audited admin routes.
 */
export function getSupabaseAdminClient() {
  return createClient<Database>(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
