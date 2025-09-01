import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AccessibleButton } from './AccessibleButton';

interface SeveritySelectorProps {
  onSelect: (severity: 'slight' | 'moderate' | 'severe') => void;
  selectedSeverity?: string;
}

export function SeveritySelector({ onSelect, selectedSeverity }: SeveritySelectorProps) {
  const severityOptions = [
    { value: 'slight', label: 'Slight', color: '#10B981' },
    { value: 'moderate', label: 'Moderate', color: '#F59E0B' },
    { value: 'severe', label: 'Severe', color: '#DC2626' },
  ] as const;

  return (
    <View style={styles.container}>
      {severityOptions.map((option) => (
        <AccessibleButton
          key={option.value}
          title={option.label}
          onPress={() => onSelect(option.value)}
          variant={selectedSeverity === option.value ? 'primary' : 'secondary'}
          style={[
            styles.severityButton,
            selectedSeverity === option.value && { backgroundColor: option.color }
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  severityButton: {
    minHeight: 56,
  },
});