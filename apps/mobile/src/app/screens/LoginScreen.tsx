import React, { useState } from 'react';
import { signInWithEmailPassword } from '@abstrack/supabase';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import { AuthForm } from '../components/AuthForm';

function validateLoginInput(email: string, password: string): string | null {
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

function mapAuthError(message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes('invalid login credentials')) {
    return 'Email or password is incorrect.';
  }

  if (normalized.includes('email not confirmed')) {
    return 'Please confirm your email before signing in.';
  }

  return message;
}

export function LoginScreen({ onGoToSignup }: { onGoToSignup: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleLogin = async () => {
    const validationError = validateLoginInput(email, password);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    const mobileSupabase = getMobileSupabaseClient();
    setLoading(true);
    setErrorMessage(null);

    const { error: authError } = await signInWithEmailPassword(
      mobileSupabase,
      email.trim(),
      password,
    );

    if (authError) {
      setErrorMessage(mapAuthError(authError.message));
    }

    setLoading(false);
  };

  return (
    <AuthForm
      title="Login"
      email={email}
      password={password}
      loading={loading}
      errorMessage={errorMessage}
      submitDisabled={!email.trim() || !password}
      emailTestId="auth-email"
      passwordTestId="auth-password"
      idleSubmitLabel="Sign in"
      loadingSubmitLabel="Signing in..."
      alternateLabel="Need an account? Sign up"
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onSubmit={handleLogin}
      onAlternateAction={onGoToSignup}
    />
  );
}
