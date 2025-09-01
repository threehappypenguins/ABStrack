import { useSettings } from '@/context/SettingsContext';
import { SpeechService } from '@/lib/speech';
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AccessibleButton } from './AccessibleButton';

interface QuestionCardProps {
  question: string;
  children: React.ReactNode;
  onSkip?: () => void;
  showSkip?: boolean;
}

export function QuestionCard({ question, children, onSkip, showSkip = true }: QuestionCardProps) {
  const { speechEnabled, textSize, highContrastMode } = useSettings();

  useEffect(() => {
    if (speechEnabled) {
      // Delay speech slightly to allow screen to render
      const timeout = setTimeout(() => {
        SpeechService.speak(question);
      }, 500);

      return () => clearTimeout(timeout);
    }
  }, [question, speechEnabled]);

  const getTextStyle = () => {
    const baseStyle = [styles.question];
    
    if (textSize === 'small') {
      baseStyle.push(styles.textSmall);
    } else if (textSize === 'large') {
      baseStyle.push(styles.textLarge);
    }

    if (highContrastMode) {
      baseStyle.push(styles.highContrastText);
    }

    return baseStyle;
  };

  const getContainerStyle = () => {
    return [
      styles.container,
      highContrastMode && styles.highContrastContainer
    ];
  };

  return (
    <View style={getContainerStyle()}>
      <Text style={getTextStyle()}>{question}</Text>
      
      <View style={styles.content}>
        {children}
      </View>

      {showSkip && onSkip && (
        <View style={styles.skipContainer}>
          <AccessibleButton
            title="Skip This Question"
            onPress={onSkip}
            variant="secondary"
            style={styles.skipButton}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    padding: 24,
    margin: 16,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  highContrastContainer: {
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    borderColor: '#000000',
  },
  question: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 20,
    lineHeight: 26,
  },
  textSmall: {
    fontSize: 16,
  },
  textLarge: {
    fontSize: 22,
  },
  highContrastText: {
    color: '#000000',
    fontWeight: '700',
  },
  content: {
    marginBottom: 16,
  },
  skipContainer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  skipButton: {
    backgroundColor: 'transparent',
  },
});