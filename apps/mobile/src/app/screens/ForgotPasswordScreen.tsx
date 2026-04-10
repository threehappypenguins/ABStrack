import React, { useState } from 'react';
import { Pressable, Text, TextInput } from 'react-native';
import { resetPasswordForEmail } from '@abstrack/supabase';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import { mapAuthError } from '../auth-helpers';
import { ScreenShell } from '../components/ScreenShell';
import { useAppStyles } from '../styles';
import { useAppTheme } from '../theme/AppThemeContext';

const MOBILE_RESET_REDIRECT_URL = 'abstrack:///update-password';

export function ForgotPasswordScreen({
  onGoToLogin,
}: {
  onGoToLogin: () => void;
}) {
  const styles = useAppStyles();
  const { colors } = useAppTheme();
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
      <Text style={styles.title}>Forgot password</Text>
      <Text style={styles.labelText}>Email</Text>
      <TextInput
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        placeholderTextColor={colors.inputPlaceholder}
        style={styles.input}
        accessibilityLabel="Email address"
        accessibilityHint="Enter your account email"
        testID="forgot-password-email"
      />

      {errorMessage ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {errorMessage}
        </Text>
      ) : null}

      {statusMessage ? (
        <Text style={styles.infoText} accessibilityRole="alert">
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
        style={[
          styles.primaryButton,
          loading || !email.trim() ? styles.primaryButtonDisabled : null,
        ]}
      >
        <Text style={styles.primaryButtonText}>
          {loading ? 'Sending reset email...' : 'Send reset email'}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to login"
        onPress={onGoToLogin}
        disabled={loading}
        style={styles.secondaryButton}
      >
        <Text style={styles.secondaryButtonText}>Back to login</Text>
      </Pressable>
    </ScreenShell>
  );
}
