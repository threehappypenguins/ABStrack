import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as main from '../index.js';
import { getSupabasePublishableKey, getSupabaseUrl } from './env-public.js';

const urlKeys = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
] as const;
const keyKeys = [
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
] as const;

describe('env-public', () => {
  const snapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of [...urlKeys, ...keyKeys]) {
      snapshot[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of [...urlKeys, ...keyKeys]) {
      if (snapshot[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = snapshot[k];
      }
    }
  });

  it('getSupabaseUrl throws when unset', () => {
    expect(() => getSupabaseUrl()).toThrow(/Missing Supabase URL/);
  });

  it('getSupabaseUrl prefers NEXT_PUBLIC_', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://a.test';
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://b.test';
    expect(getSupabaseUrl()).toBe('https://a.test');
  });

  it('getSupabasePublishableKey throws when unset', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.test';
    expect(() => getSupabasePublishableKey()).toThrow(
      /Missing Supabase publishable/,
    );
  });

  it('getSupabasePublishableKey reads publishable or legacy anon', () => {
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_x';
    expect(getSupabasePublishableKey()).toBe('sb_publishable_x');
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'eyJlegacy';
    expect(getSupabasePublishableKey()).toBe('eyJlegacy');
  });
});

describe('public entry', () => {
  it('does not expose service-role helpers', () => {
    expect(main).not.toHaveProperty('getSupabaseAdminClient');
    expect(main).not.toHaveProperty('getSupabaseSecretKey');
  });

  it('does not pull Next SSR entrypoints (use @abstrack/supabase/browser and /server)', () => {
    expect(main).not.toHaveProperty('getSupabaseBrowserClient');
    expect(main).not.toHaveProperty('createSupabaseServerClient');
  });
});

