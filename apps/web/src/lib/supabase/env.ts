export function getSupabaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  }
  return value;
}

export function getSupabaseClientKey(): string {
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (publishable) {
    return publishable;
  }

  const legacyAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (legacyAnon) {
    return legacyAnon;
  }

  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY)',
  );
}
