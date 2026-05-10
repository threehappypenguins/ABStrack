export function getSupabaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  }
  return value;
}

export function getSupabaseClientKey(): string {
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (publishable) {
    return publishable;
  }

  throw new Error('Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
}
