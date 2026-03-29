import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';
import { getSupabaseUrl } from './env-public.js';

/**
 * Server-only secret or legacy service_role JWT. Never import this module from client code.
 */
export function getSupabaseServiceRoleKey(): string {
  const key =
    (typeof process !== 'undefined' && process.env
      ? process.env.SUPABASE_SECRET_KEY ??
        process.env.SUPABASE_SERVICE_ROLE_KEY
      : undefined) ?? undefined;
  if (!key) {
    throw new Error(
      'Missing SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY (server-only).',
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
