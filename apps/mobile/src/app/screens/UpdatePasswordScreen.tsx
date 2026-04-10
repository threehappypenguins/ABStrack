import React, { useEffect, useState } from 'react';
import { Pressable, Text, TextInput } from 'react-native';
import { signOut, updatePassword } from '@abstrack/supabase';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import { mapAuthError, validateSignupPassword } from '../auth-helpers';
import { ScreenShell } from '../components/ScreenShell';
import { useAppStyles } from '../styles';
import { useAppTheme } from '../theme/AppThemeContext';

export function UpdatePasswordScreen({
  recoveryError,
  onGoToLogin,
  onPasswordUpdated,
}: {
  recoveryError: string | null;
  onGoToLogin: () => void;
  onPasswordUpdated: () => void;
}) {
  const styles = useAppStyles();
  const { colors } = useAppTheme();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    recoveryError,
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    setErrorMessage(recoveryError);
  }, [recoveryError]);

  const isSubmitDisabled =
    loading ||
    Boolean(recoveryError) ||
    !password.trim() ||
    !confirmPassword.trim();

  const handleUpdatePassword = async () => {
    if (recoveryError) {
      setErrorMessage(recoveryError);
      setStatusMessage(null);
      return;
    }

    const passwordError = validateSignupPassword(password);
    if (passwordError) {
      setErrorMessage(passwordError);
      setStatusMessage(null);
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      setStatusMessage(null);
      return;
    }

    const mobileSupabase = getMobileSupabaseClient();
    setLoading(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const {
        data: { session },
      } = await mobileSupabase.auth.getSession();

      if (!session) {
        setErrorMessage(
          'This reset link is invalid or expired. Request a new one.',
        );
        return;
      }

      const { error } = await updatePassword(mobileSupabase, password);
      if (error) {
        setErrorMessage(mapAuthError(error.message));
        return;
      }

      await signOut(mobileSupabase);
      setStatusMessage('Password updated. Redirecting to login...');
      onPasswordUpdated();
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
      <Text style={styles.title}>Set new password</Text>
      <Text style={styles.labelText}>New password</Text>
      <TextInput
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="password-new"
        textContentType="newPassword"
        value={password}
        onChangeText={setPassword}
        placeholder="New password"
        placeholderTextColor={colors.inputPlaceholder}
        style={styles.input}
        accessibilityLabel="New password"
        testID="update-password-new"
      />

      <Text style={styles.labelText}>Confirm new password</Text>
      <TextInput
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="password-new"
        textContentType="newPassword"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        placeholder="Confirm new password"
        placeholderTextColor={colors.inputPlaceholder}
        style={styles.input}
        accessibilityLabel="Confirm new password"
        testID="update-password-confirm"
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
          loading ? 'Updating password...' : 'Update password'
        }
        onPress={handleUpdatePassword}
        disabled={isSubmitDisabled}
        style={[
          styles.primaryButton,
          isSubmitDisabled ? styles.primaryButtonDisabled : null,
        ]}
      >
        <Text style={styles.primaryButtonText}>
          {loading ? 'Updating password...' : 'Update password'}
        </Text>
      </Pressable>

      {recoveryError ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to login"
          onPress={onGoToLogin}
          disabled={loading}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>Back to login</Text>
        </Pressable>
      ) : null}
    </ScreenShell>
  );
}
