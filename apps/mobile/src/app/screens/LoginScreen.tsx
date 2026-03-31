import React, { useState } from 'react';
import { signInWithEmailPassword } from '@abstrack/supabase';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import { AuthForm } from '../components/AuthForm';

export function LoginScreen({
  onGoToSignup,
}: {
  onGoToSignup: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    const mobileSupabase = getMobileSupabaseClient();
    setLoading(true);
    setError(null);

    const { error: authError } = await signInWithEmailPassword(
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
      title="Login"
      email={email}
      password={password}
      loading={loading}
      error={error}
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
