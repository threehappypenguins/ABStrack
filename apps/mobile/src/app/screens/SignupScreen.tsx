import React, { useState } from 'react';
import { signUpWithEmailPassword } from '@abstrack/supabase';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import { AuthForm } from '../components/AuthForm';

export function SignupScreen({
  onGoToLogin,
}: {
  onGoToLogin: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignup = async () => {
    const mobileSupabase = getMobileSupabaseClient();
    setLoading(true);
    setError(null);

    const { error: authError } = await signUpWithEmailPassword(
      mobileSupabase,
      email.trim(),
      password,
    );

    if (authError) {
      setError(authError.message);
    }

    setLoading(false);
  };

  return (
    <AuthForm
      title="Sign up"
      email={email}
      password={password}
      loading={loading}
      error={error}
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
