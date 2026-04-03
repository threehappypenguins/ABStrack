import React, { useState } from 'react';
import { signUpWithEmailPassword } from '@abstrack/supabase';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import { AuthForm } from '../components/AuthForm';
import {
  mapAuthError,
  validateEmailPassword,
  validateSignupPassword,
} from '../auth-helpers';

export function SignupScreen({ onGoToLogin }: { onGoToLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleSignup = async () => {
    const validationError =
      validateEmailPassword(email, password) ?? validateSignupPassword(password);
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
