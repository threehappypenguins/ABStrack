import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signInWithEmailPassword } from './auth.js';
import { createSupabaseServerClient } from './server-client.js';

const ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
] as const;

describe('client assignability', () => {
  const snapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      snapshot[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = snapshot[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('createSupabaseServerClient result is accepted by auth helpers (types only)', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
    const client = createSupabaseServerClient({ getAll: () => [] });
    const deferred = () => signInWithEmailPassword(client, 'a@example.com', 'pw');
    expect(deferred).toBeDefined();
  });
});
