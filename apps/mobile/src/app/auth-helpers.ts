export function validateEmailPassword(
  email: string,
  password: string,
): string | null {
  const trimmedEmail = email.trim();
  const hasEmailFormat = /.+@.+\..+/.test(trimmedEmail);

  if (!trimmedEmail || !password) {
    return 'Enter your email and password.';
  }

  if (!hasEmailFormat) {
    return 'Enter a valid email address.';
  }

  return null;
}

export function validateSignupPassword(password: string): string | null {
  if (password.length < 8) {
    return 'Password must be at least 8 characters.';
  }

  return null;
}

export function mapAuthError(message: string): string {
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

  return message;
}