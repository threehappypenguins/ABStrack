import React from 'react';
import { Button, Text, TextInput, View } from 'react-native';
import { ScreenShell } from './ScreenShell';
import { styles } from '../styles';

export type AuthFormProps = {
  title: string;
  email: string;
  password: string;
  loading: boolean;
  error: string | null;
  emailTestId: string;
  passwordTestId: string;
  idleSubmitLabel: string;
  loadingSubmitLabel: string;
  alternateLabel: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  onAlternateAction: () => void;
};

export function AuthForm({
  title,
  email,
  password,
  loading,
  error,
  emailTestId,
  passwordTestId,
  idleSubmitLabel,
  loadingSubmitLabel,
  alternateLabel,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onAlternateAction,
}: AuthFormProps) {
  return (
    <ScreenShell>
      <Text style={styles.title}>{title}</Text>
      <TextInput
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={onEmailChange}
        placeholder="you@example.com"
        style={styles.input}
        testID={emailTestId}
      />
      <TextInput
        secureTextEntry
        value={password}
        onChangeText={onPasswordChange}
        placeholder="Password"
        style={styles.input}
        testID={passwordTestId}
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Button
        title={loading ? loadingSubmitLabel : idleSubmitLabel}
        onPress={onSubmit}
        disabled={loading}
      />

      <View style={styles.spacer} />
      <Button title={alternateLabel} onPress={onAlternateAction} />
    </ScreenShell>
  );
}
