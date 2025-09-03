// components/AccessibleButton.tsx
import { useSettings } from '@/context/SettingsContext';
import { SpeechService } from '@/lib/speech';
import React from 'react';
import { Text, TouchableOpacity, StyleSheet, ViewStyle, TextStyle } from 'react-native';

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

  const getButtonStyle = (): ViewStyle => {
    if (disabled) {
      return { backgroundColor: '#9CA3AF', opacity: 0.6 };
    }

    if (variant === 'primary') {
      return highContrastMode 
        ? { backgroundColor: '#000000', borderWidth: 2, borderColor: '#FFFFFF' }
        : { backgroundColor: '#2563EB' };
    }
    
    if (variant === 'secondary') {
      return highContrastMode 
        ? { backgroundColor: '#FFFFFF', borderWidth: 3, borderColor: '#000000' }
        : { backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#D1D5DB' };
    }
    
    if (variant === 'danger') {
      return { backgroundColor: '#DC2626' };
    }
    
    if (variant === 'success') {
      return { backgroundColor: '#059669' };
    }

    return { backgroundColor: '#2563EB' };
  };

  const getTextStyle = (): TextStyle => {
    let fontSize = 16;
    if (textSize === 'small') fontSize = 14;
    if (textSize === 'large') fontSize = 20;

    const color = (variant === 'secondary' && !highContrastMode && !disabled) 
      ? '#374151' 
      : '#FFFFFF';

    return {
      fontSize,
      fontWeight: '600',
      color,
    };
  };

  return (
    <TouchableOpacity
      style={[styles.button, getButtonStyle(), style]}
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <Text style={[getTextStyle(), textStyle]}>
        {title}
      </Text>
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
});