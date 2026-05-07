import { MOBILE_AUTH_SESSION_RECOVERY_USER_MESSAGE } from '../lib/get-mobile-auth-session-safe';

export function validateEmailPassword(
  email: string,
  password: string,
): string | null {
  const trimmedEmail = email.trim();
  const hasPassword = password.trim().length > 0;
  const hasEmailFormat = /.+@.+\..+/.test(trimmedEmail);

  if (!trimmedEmail || !hasPassword) {
    return 'Enter your email and password.';
  }

  if (!hasEmailFormat) {
    return 'Enter a valid email address.';
  }

  return null;
}

export function validateSignupPassword(password: string): string | null {
  if (password.trim().length < 8) {
    return 'Password must be at least 8 characters.';
  }

  return null;
}

/**
 * Maps Supabase auth errors to user-friendly messages.
 * Unknown errors return a generic message to avoid leaking implementation details;
 * the original error is logged for telemetry/debugging.
 */
export function mapAuthError(message: string): string {
  if (message === MOBILE_AUTH_SESSION_RECOVERY_USER_MESSAGE) {
    return message;
  }

  const normalized = message.toLowerCase();

  if (normalized.includes('invalid login credentials')) {
    return 'Email or password is incorrect.';
  }

  if (normalized.includes('email not confirmed')) {
    return 'Please confirm your email before signing in.';
  }

  if (normalized.includes('already registered')) {
    return 'An account with this email already exists.';
  }

  // Log unmapped errors for telemetry/debugging; return generic message to user
  console.warn('[Auth] Unmapped Supabase error:', message);
  return 'An error occurred during authentication. Please try again.';
}
