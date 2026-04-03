import {
  mapAuthError,
  validateEmailPassword,
  validateSignupPassword,
} from './auth-helpers';

describe('validateEmailPassword', () => {
  test('returns error when both fields are empty', () => {
    expect(validateEmailPassword('', '')).toBe('Enter your email and password.');
  });

  test('returns error for whitespace-only password', () => {
    expect(validateEmailPassword('user@example.com', '   ')).toBe(
      'Enter your email and password.',
    );
  });

  test('returns error for invalid email', () => {
    expect(validateEmailPassword('invalid-email', 'password123')).toBe(
      'Enter a valid email address.',
    );
  });

  test('returns null for valid credentials', () => {
    expect(validateEmailPassword('user@example.com', 'password123')).toBeNull();
  });
});

describe('validateSignupPassword', () => {
  test('returns error for short password', () => {
    expect(validateSignupPassword('short')).toBe(
      'Password must be at least 8 characters.',
    );
  });

  test('returns error when trimmed password is too short', () => {
    expect(validateSignupPassword('   abcdefg')).toBe(
      'Password must be at least 8 characters.',
    );
  });

  test('returns null for valid password length', () => {
    expect(validateSignupPassword('abcdefgh')).toBeNull();
  });
});

describe('mapAuthError', () => {
  test('maps invalid login credentials', () => {
    expect(mapAuthError('Invalid login credentials')).toBe(
      'Email or password is incorrect.',
    );
  });

  test('maps email not confirmed message', () => {
    expect(mapAuthError('Email not confirmed')).toBe(
      'Please confirm your email before signing in.',
    );
  });

  test('maps already registered message', () => {
    expect(mapAuthError('User already registered')).toBe(
      'An account with this email already exists.',
    );
  });

  test('returns original message for unknown error', () => {
    expect(mapAuthError('Some unexpected error')).toBe('Some unexpected error');
  });
});