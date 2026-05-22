import { describe, expect, it } from 'vitest';
import { isSupabaseAuthApiError } from './auth.js';

describe('isSupabaseAuthApiError', () => {
  it('returns true for Supabase Auth API errors', () => {
    expect(
      isSupabaseAuthApiError({
        __isAuthError: true,
        message: 'Network error',
      }),
    ).toBe(true);
  });

  it('returns false for ordinary errors', () => {
    expect(isSupabaseAuthApiError(new Error('nope'))).toBe(false);
  });
});
