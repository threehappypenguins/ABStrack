// components/AccessibleButton.tsx
import { useSettings } from '@/context/SettingsContext';
import { SpeechService } from '@/lib/speech';
import React from 'react';
import { StyleSheet, Text, TextStyle, TouchableOpacity, ViewStyle } from 'react-native';

interface AccessibleButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'success';
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  speakOnPress?: boolean;
}

export function AccessibleButton({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  style,
  textStyle,
  speakOnPress = false,
}: AccessibleButtonProps) {
  const { speechEnabled, textSize, highContrastMode } = useSettings();

  const handlePress = async () => {
    if (speakOnPress && speechEnabled) {
      await SpeechService.speak(title);
    }
    onPress();
  };

  const getButtonStyle = () => {
    const baseStyle = [styles.button];
    
    if (variant === 'primary') {
      baseStyle.push(highContrastMode ? styles.primaryHighContrast : styles.primary);
    } else if (variant === 'secondary') {
      baseStyle.push(highContrastMode ? styles.secondaryHighContrast : styles.secondary);
    } else if (variant === 'danger') {
      baseStyle.push(styles.danger);
    } else if (variant === 'success') {
      baseStyle.push(styles.success);
    }

    if (disabled) {
      baseStyle.push(styles.disabled);
    }

    return baseStyle;
  };

  const getTextStyle = () => {
    const baseStyle = [styles.text];
    
    if (textSize === 'small') {
      baseStyle.push(styles.textSmall);
    } else if (textSize === 'large') {
      baseStyle.push(styles.textLarge);
    }

    if (variant === 'secondary' && !highContrastMode) {
      baseStyle.push(styles.secondaryText);
    }

    return baseStyle;
  };

  return (
    <TouchableOpacity
      style={[...getButtonStyle(), style]}
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <Text style={[...getTextStyle(), textStyle]}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },
  primary: {
    backgroundColor: '#2563EB',
  },
  primaryHighContrast: {
    backgroundColor: '#000000',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  secondary: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  secondaryHighContrast: {
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    borderColor: '#000000',
  },
  danger: {
    backgroundColor: '#DC2626',
  },
  success: {
    backgroundColor: '#059669',
  },
  disabled: {
    backgroundColor: '#9CA3AF',
    opacity: 0.6,
  },
  text: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  textSmall: {
    fontSize: 14,
  },
  textLarge: {
    fontSize: 20,
  },
  secondaryText: {
    color: '#374151',
  },
});