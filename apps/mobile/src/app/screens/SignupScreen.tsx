import React, { useState } from 'react';
import { signUpWithEmailPassword } from '@abstrack/supabase';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import { AuthForm } from '../components/AuthForm';

function validateSignupInput(email: string, password: string): string | null {
  const trimmedEmail = email.trim();
  const hasEmailFormat = /.+@.+\..+/.test(trimmedEmail);

  if (!trimmedEmail || !password) {
    return 'Enter your email and password.';
  }

  if (!hasEmailFormat) {
    return 'Enter a valid email address.';
  }

  if (password.length < 8) {
    return 'Password must be at least 8 characters.';
  }

  return null;
}

function mapAuthError(message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes('already registered')) {
    return 'An account with this email already exists.';
  }

  return message;
}

export function SignupScreen({ onGoToLogin }: { onGoToLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleSignup = async () => {
    const validationError = validateSignupInput(email, password);
    if (validationError) {
      setErrorMessage(validationError);
      setStatusMessage(null);
      return;
    }

    const mobileSupabase = getMobileSupabaseClient();
    setLoading(true);
    setErrorMessage(null);
    setStatusMessage(null);

    const { data, error: authError } = await signUpWithEmailPassword(
      mobileSupabase,
      email.trim(),
      password,
    );

    if (authError) {
      setErrorMessage(mapAuthError(authError.message));
    } else if (!data.session) {
      setStatusMessage('Account created. Check your email to confirm your account.');
    }

    setLoading(false);
  };

  return (
    <AuthForm
      title="Sign up"
      email={email}
      password={password}
      loading={loading}
      errorMessage={errorMessage}
      statusMessage={statusMessage}
      submitDisabled={!email.trim() || !password}
      emailTestId="signup-email"
      passwordTestId="signup-password"
      idleSubmitLabel="Create account"
      loadingSubmitLabel="Creating account..."
      alternateLabel="Already have an account? Login"
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onSubmit={handleSignup}
      onAlternateAction={onGoToLogin}
    />
  );
}
