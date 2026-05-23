import { describe, expect, it } from 'vitest';
import { isAuthSessionMissingError, isSupabaseAuthApiError } from './auth.js';

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

describe('isAuthSessionMissingError', () => {
  it('returns true for AuthSessionMissingError', () => {
    expect(
      isAuthSessionMissingError(
        Object.assign(new Error('Auth session missing!'), {
          name: 'AuthSessionMissingError',
        }),
      ),
    ).toBe(true);
  });

  it('returns false for other auth errors', () => {
    expect(
      isAuthSessionMissingError({
        __isAuthError: true,
        message: 'Invalid JWT',
      }),
    ).toBe(false);
  });
});
