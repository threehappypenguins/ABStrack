import React, { useState } from 'react';
import { Pressable, Text, TextInput } from 'react-native';
import { resetPasswordForEmail } from '@abstrack/supabase';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import { mapAuthError } from '../auth-helpers';
import { ScreenShell } from '../components/ScreenShell';
import { nw } from '../theme/app-nativewind-classes';

const MOBILE_RESET_REDIRECT_URL = 'abstrack:///update-password';

const inputClassName = `min-h-[52px] rounded-lg px-3 py-2.5 text-base ${nw.input}`;

export function ForgotPasswordScreen({
  onGoToLogin,
}: {
  onGoToLogin: () => void;
}) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleForgotPassword = async () => {
    const trimmedEmail = email.trim();
    const hasEmailFormat = /.+@.+\..+/.test(trimmedEmail);

    if (!trimmedEmail || !hasEmailFormat) {
      setErrorMessage('Enter a valid email address.');
      setStatusMessage(null);
      return;
    }

    const mobileSupabase = getMobileSupabaseClient();
    setLoading(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const { error } = await resetPasswordForEmail(
        mobileSupabase,
        trimmedEmail,
        {
          redirectTo: MOBILE_RESET_REDIRECT_URL,
        },
      );

      if (error) {
        setErrorMessage(mapAuthError(error.message));
        return;
      }

      setStatusMessage(
        'Password reset email sent. Check your inbox for the recovery link.',
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unexpected authentication error';
      setErrorMessage(mapAuthError(message));
      setStatusMessage(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenShell>
      <Text className={`text-[22px] font-semibold ${nw.textInk}`}>
        Forgot password
      </Text>
      <Text className={`text-base font-semibold ${nw.textInk}`}>Email</Text>
      <TextInput
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        className={inputClassName}
        accessibilityLabel="Email address"
        accessibilityHint="Enter your account email"
        testID="forgot-password-email"
      />

      {errorMessage ? (
        <Text className={`text-sm ${nw.textError}`} accessibilityRole="alert">
          {errorMessage}
        </Text>
      ) : null}

      {statusMessage ? (
        <Text className={`text-sm ${nw.textInfo}`} accessibilityRole="alert">
          {statusMessage}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          loading ? 'Sending reset email...' : 'Send reset email'
        }
        onPress={handleForgotPassword}
        disabled={loading || !email.trim()}
        className={`min-h-[52px] items-center justify-center rounded-[10px] px-4 ${nw.btnPrimary} ${loading || !email.trim() ? 'opacity-60' : ''}`}
      >
        <Text className={`text-lg font-bold ${nw.textOnPrimary}`}>
          {loading ? 'Sending reset email...' : 'Send reset email'}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to login"
        onPress={onGoToLogin}
        disabled={loading}
        className={`min-h-[52px] items-center justify-center rounded-[10px] px-4 ${nw.btnSecondary}`}
      >
        <Text
          className={`text-center text-[17px] font-semibold ${nw.textPrimary}`}
        >
          Back to login
        </Text>
      </Pressable>
    </ScreenShell>
  );
}
