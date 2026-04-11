import React, { useRef } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ScreenShell } from './ScreenShell';
import { nw } from '../theme/app-nativewind-classes';

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
  tertiaryLabel?: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
  onAlternateAction: () => void;
  onTertiaryAction?: () => void;
};

const inputClassName = `min-h-[52px] rounded-lg px-3 py-2.5 text-base ${nw.input}`;

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
  tertiaryLabel,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onAlternateAction,
  onTertiaryAction,
}: AuthFormProps) {
  const passwordInputRef = useRef<TextInput>(null);
  const primaryDisabled = loading || Boolean(submitDisabled);
  const handleSubmit = () => {
    if (primaryDisabled) {
      return;
    }

    onSubmit();
  };

  return (
    <ScreenShell>
      <Text className={`text-[22px] font-semibold ${nw.textInk}`}>{title}</Text>
      <Text className={`text-base font-semibold ${nw.textInk}`}>Email</Text>
      <TextInput
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        value={email}
        onChangeText={onEmailChange}
        placeholder="you@example.com"
        className={inputClassName}
        accessibilityLabel="Email address"
        accessibilityHint="Enter your account email"
        returnKeyType="next"
        blurOnSubmit={false}
        onSubmitEditing={() => passwordInputRef.current?.focus()}
        testID={emailTestId}
      />
      <Text className={`text-base font-semibold ${nw.textInk}`}>Password</Text>
      <TextInput
        ref={passwordInputRef}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="password"
        textContentType="password"
        value={password}
        onChangeText={onPasswordChange}
        placeholder="Password"
        className={inputClassName}
        accessibilityLabel="Password"
        accessibilityHint="Enter your account password"
        returnKeyType="done"
        onSubmitEditing={handleSubmit}
        testID={passwordTestId}
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
        accessibilityLabel={loading ? loadingSubmitLabel : idleSubmitLabel}
        onPress={handleSubmit}
        disabled={primaryDisabled}
        className={`min-h-[52px] items-center justify-center rounded-[10px] px-4 ${nw.btnPrimary} ${primaryDisabled ? 'opacity-60' : ''}`}
      >
        <Text className={`text-lg font-bold ${nw.textOnPrimary}`}>
          {loading ? loadingSubmitLabel : idleSubmitLabel}
        </Text>
      </Pressable>

      <View className="h-2" />
      {tertiaryLabel && onTertiaryAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tertiaryLabel}
          onPress={onTertiaryAction}
          disabled={loading}
          className="min-h-8 items-center justify-center"
        >
          <Text
            className={`text-center text-[15px] font-medium ${nw.textPrimary}`}
          >
            {tertiaryLabel}
          </Text>
        </Pressable>
      ) : null}
      {tertiaryLabel && onTertiaryAction ? <View className="h-2" /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={alternateLabel}
        onPress={onAlternateAction}
        disabled={loading}
        className={`min-h-[52px] items-center justify-center rounded-[10px] px-4 ${nw.btnSecondary}`}
      >
        <Text
          className={`text-center text-[17px] font-semibold ${nw.textPrimary}`}
        >
          {alternateLabel}
        </Text>
      </Pressable>
    </ScreenShell>
  );
}
