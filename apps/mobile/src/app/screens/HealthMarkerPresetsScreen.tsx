import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppNavigationShell } from '../components/AppNavigationShell';
import { AsyncScreenContainer } from '../components/AsyncScreenContainer';
import { useAppTheme } from '../theme/AppThemeContext';

/**
 * Health marker presets landing screen. CRUD and Supabase wiring are out of scope; shows
 * placeholder content with async loading/error containers ready for future data.
 *
 * @returns Screen scaffold.
 */
export function HealthMarkerPresetsScreen() {
  const { colors } = useAppTheme();

  return (
    <AppNavigationShell title="Health marker presets">
      <AsyncScreenContainer status="ready">
        <ScrollView
          contentContainerStyle={markerStyles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={[
              markerStyles.panel,
              {
                borderColor: colors.border,
                backgroundColor: colors.surface,
              },
            ]}
          >
            <Text
              style={[markerStyles.lead, { color: colors.muted }]}
              maxFontSizeMultiplier={2}
              testID="health-marker-presets-placeholder"
            >
              You have not created any health marker presets yet. When this
              feature is connected, you will configure the markers you track
              alongside episodes.
            </Text>
          </View>
        </ScrollView>
      </AsyncScreenContainer>
    </AppNavigationShell>
  );
}

const markerStyles = StyleSheet.create({
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
