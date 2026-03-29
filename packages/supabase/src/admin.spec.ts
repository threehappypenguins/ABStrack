import { describe, expect, it } from 'vitest';
import { getSupabaseServiceRoleKey } from './admin.js';

describe('@abstrack/supabase/admin', () => {
  const snapshot = {
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  it('getSupabaseServiceRoleKey throws when secret env is missing', () => {
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => getSupabaseServiceRoleKey()).toThrow(
      /Missing SUPABASE_SECRET_KEY/,
    );
  });

  it('getSupabaseServiceRoleKey reads SUPABASE_SECRET_KEY', () => {
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_unit_test';
    expect(getSupabaseServiceRoleKey()).toBe('sb_secret_unit_test');
    if (snapshot.SUPABASE_SECRET_KEY === undefined) {
      delete process.env.SUPABASE_SECRET_KEY;
    } else {
      process.env.SUPABASE_SECRET_KEY = snapshot.SUPABASE_SECRET_KEY;
    }
    if (snapshot.SUPABASE_SERVICE_ROLE_KEY === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = snapshot.SUPABASE_SERVICE_ROLE_KEY;
    }
  });
});
