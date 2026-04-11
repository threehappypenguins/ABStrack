import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { AppNavigationShell } from '../components/AppNavigationShell';
import { AsyncScreenContainer } from '../components/AsyncScreenContainer';
import { nw } from '../theme/app-nativewind-classes';

/**
 * Symptom presets landing screen. CRUD and Supabase wiring are out of scope; shows placeholder
 * content with async loading/error containers ready for future data.
 *
 * @returns Screen scaffold.
 */
export function SymptomPresetsScreen() {
  return (
    <AppNavigationShell title="Symptom presets">
      <AsyncScreenContainer status="ready">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            flexGrow: 1,
            padding: 16,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View className={`rounded-xl p-4 ${nw.card}`}>
            <Text
              className={`text-base leading-6 ${nw.textMuted}`}
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
