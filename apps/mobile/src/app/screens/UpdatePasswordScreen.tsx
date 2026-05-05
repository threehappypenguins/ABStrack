import React, { useEffect, useState } from 'react';
import { Pressable, Text, TextInput } from 'react-native';
import { signOut, updatePassword } from '@abstrack/supabase';
import {
  getMobileAuthSessionSafe,
  getMobileSupabaseClient,
} from '../../lib/supabase-wiring';
import { mapAuthError, validateSignupPassword } from '../auth-helpers';
import { ScreenShell } from '../components/ScreenShell';
import { nw } from '../theme/app-nativewind-classes';

const inputClassName = `min-h-[52px] rounded-lg px-3 py-2.5 text-base ${nw.input}`;

export function UpdatePasswordScreen({
  recoveryError,
  onGoToLogin,
  onPasswordUpdated,
}: {
  recoveryError: string | null;
  onGoToLogin: () => void;
  onPasswordUpdated: () => void;
}) {
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
      } = await getMobileAuthSessionSafe();

      // `getMobileAuthSessionSafe` can return identity with `access_token: ''` after offline refresh
      // failure — not a usable recovery JWT for `updatePassword`.
      if (!session || !session.access_token?.trim()) {
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
      <Text className={`text-[22px] font-semibold ${nw.textInk}`}>
        Set new password
      </Text>
      <Text className={`text-base font-semibold ${nw.textInk}`}>
        New password
      </Text>
      <TextInput
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="password-new"
        textContentType="newPassword"
        value={password}
        onChangeText={setPassword}
        placeholder="New password"
        className={inputClassName}
        accessibilityLabel="New password"
        testID="update-password-new"
      />

      <Text className={`text-base font-semibold ${nw.textInk}`}>
        Confirm new password
      </Text>
      <TextInput
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="password-new"
        textContentType="newPassword"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        placeholder="Confirm new password"
        className={inputClassName}
        accessibilityLabel="Confirm new password"
        testID="update-password-confirm"
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
          loading ? 'Updating password...' : 'Update password'
        }
        onPress={handleUpdatePassword}
        disabled={isSubmitDisabled}
        className={`min-h-[52px] items-center justify-center rounded-[10px] px-4 ${nw.btnPrimary} ${isSubmitDisabled ? 'opacity-60' : ''}`}
      >
        <Text className={`text-lg font-bold ${nw.textOnPrimary}`}>
          {loading ? 'Updating password...' : 'Update password'}
        </Text>
      </Pressable>

      {recoveryError ? (
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
      ) : null}
    </ScreenShell>
  );
}
