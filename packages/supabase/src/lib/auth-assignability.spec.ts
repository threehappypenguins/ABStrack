import { describe, expect, it } from 'vitest';
import { signInWithEmailPassword } from './auth.js';
import { createSupabaseServerClient } from './server-client.js';

describe('client assignability', () => {
  it('createSupabaseServerClient result is accepted by auth helpers (types only)', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
    const client = createSupabaseServerClient({ getAll: () => [] });
    const deferred = () => signInWithEmailPassword(client, 'a@example.com', 'pw');
    expect(deferred).toBeDefined();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  });
});
