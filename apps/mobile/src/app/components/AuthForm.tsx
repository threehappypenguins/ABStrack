import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ScreenShell } from './ScreenShell';
import { styles } from '../styles';

export type AuthFormProps = {
  title: string;
  email: string;
  password: string;
  loading: boolean;
  errorMessage: string | null;
  statusMessage?: string | null;
  submitDisabled?: boolean;
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
  errorMessage,
  statusMessage,
  submitDisabled,
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
  const primaryDisabled = loading || Boolean(submitDisabled);
  const handleSubmit = () => {
    if (primaryDisabled) {
      return;
    }

    onSubmit();
  };

  return (
    <ScreenShell>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.labelText}>Email</Text>
      <TextInput
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        value={email}
        onChangeText={onEmailChange}
        placeholder="you@example.com"
        style={styles.input}
        accessibilityLabel="Email address"
        accessibilityHint="Enter your account email"
        returnKeyType="next"
        testID={emailTestId}
      />
      <Text style={styles.labelText}>Password</Text>
      <TextInput
        secureTextEntry
        autoComplete="password"
        textContentType="password"
        value={password}
        onChangeText={onPasswordChange}
        placeholder="Password"
        style={styles.input}
        accessibilityLabel="Password"
        accessibilityHint="Enter your account password"
        returnKeyType="done"
        onSubmitEditing={handleSubmit}
        testID={passwordTestId}
      />

      {errorMessage ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {errorMessage}
        </Text>
      ) : null}

      {statusMessage ? <Text style={styles.infoText}>{statusMessage}</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={loading ? loadingSubmitLabel : idleSubmitLabel}
        onPress={handleSubmit}
        disabled={primaryDisabled}
        style={[
          styles.primaryButton,
          primaryDisabled ? styles.primaryButtonDisabled : null,
        ]}
      >
        <Text style={styles.primaryButtonText}>
          {loading ? loadingSubmitLabel : idleSubmitLabel}
        </Text>
      </Pressable>

      <View style={styles.spacer} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={alternateLabel}
        onPress={onAlternateAction}
        disabled={loading}
        style={styles.secondaryButton}
      >
        <Text style={styles.secondaryButtonText}>{alternateLabel}</Text>
      </Pressable>
    </ScreenShell>
  );
}
