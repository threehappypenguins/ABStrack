import { getSupabasePublishableKey } from '@abstrack/supabase';

export function getSupabaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!value) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  }
  return value;
}

/**
 * Next.js publishable key for `@supabase/ssr` clients. Delegates to **`getSupabasePublishableKey`**
 * so values must be **`sb_publishable_…`**; **`sb_secret_…`** is rejected to avoid shipping a secret
 * in **`NEXT_PUBLIC_*`** bundles.
 */
export function getSupabaseClientKey(): string {
  return getSupabasePublishableKey();
}
