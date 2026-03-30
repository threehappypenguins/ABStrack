import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getSupabaseServiceRoleKey } from './admin.js';

describe('@abstrack/supabase/admin', () => {
  let snapshotSecret: string | undefined;

  beforeEach(() => {
    snapshotSecret = process.env.SUPABASE_SECRET_KEY;
  });

  afterEach(() => {
    if (snapshotSecret === undefined) {
      delete process.env.SUPABASE_SECRET_KEY;
    } else {
      process.env.SUPABASE_SECRET_KEY = snapshotSecret;
    }
  });

  it('getSupabaseServiceRoleKey throws when secret env is missing', () => {
    delete process.env.SUPABASE_SECRET_KEY;
    expect(() => getSupabaseServiceRoleKey()).toThrow(
      /Missing SUPABASE_SECRET_KEY/,
    );
  });

  it('getSupabaseServiceRoleKey reads SUPABASE_SECRET_KEY', () => {
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_unit_test';
    expect(getSupabaseServiceRoleKey()).toBe('sb_secret_unit_test');
  });
});
