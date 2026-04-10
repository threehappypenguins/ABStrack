import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppNavigationShell } from '../components/AppNavigationShell';
import { AsyncScreenContainer } from '../components/AsyncScreenContainer';
import { useAppTheme } from '../theme/AppThemeContext';

/**
 * Symptom presets landing screen. CRUD and Supabase wiring are out of scope; shows placeholder
 * content with async loading/error containers ready for future data.
 *
 * @returns Screen scaffold.
 */
export function SymptomPresetsScreen() {
  const { colors } = useAppTheme();

  return (
    <AppNavigationShell title="Symptom presets">
      <AsyncScreenContainer status="ready">
        <ScrollView
          contentContainerStyle={symptomStyles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={[
              symptomStyles.panel,
              {
                borderColor: colors.border,
                backgroundColor: colors.surface,
              },
            ]}
          >
            <Text
              style={[symptomStyles.lead, { color: colors.muted }]}
              maxFontSizeMultiplier={2}
              testID="symptom-presets-placeholder"
            >
              You have not created any symptom presets yet. When this feature is
              connected, you will define named lists of symptoms and response
              types for episode logging.
            </Text>
          </View>
        </ScrollView>
      </AsyncScreenContainer>
    </AppNavigationShell>
  );
}

const symptomStyles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    padding: 16,
  },
  panel: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  lead: {
    fontSize: 16,
    lineHeight: 24,
  },
});
