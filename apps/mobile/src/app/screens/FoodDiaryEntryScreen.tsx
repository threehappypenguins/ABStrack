import React, { useMemo, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import type { MealTag } from '@abstrack/types';
import { MEAL_TAGS } from '@abstrack/types';
import { createFoodDiaryEntry } from '@abstrack/supabase';
import { announce, COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import { ScreenShell } from '../components/ScreenShell';
import type { MainStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/AppThemeContext';
import { nw } from '../theme/app-nativewind-classes';

type FoodDiaryEntryRoute = RouteProp<MainStackParamList, 'FoodDiaryEntry'>;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function currentLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function currentLocalTime(): string {
  const now = new Date();
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

function localDateTimeToIso(datePart: string, timePart: string): string | null {
  const date = datePart.trim();
  const time = timePart.trim();
  if (!date || !time) {
    return null;
  }
  const parsed = new Date(`${date}T${time}`);
  const value = parsed.getTime();
  if (!Number.isFinite(value)) {
    return null;
  }
  return parsed.toISOString();
}

function localDateFromDate(value: Date): string {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

function localTimeFromDate(value: Date): string {
  return `${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
}

/**
 * Standalone food diary creation screen (home entry point). Optional episode link can be supplied.
 *
 * @returns Form for meal tag, log timestamp, and free-text food note.
 */
export function FoodDiaryEntryScreen() {
  const route = useRoute<FoodDiaryEntryRoute>();
  const { colors } = useAppTheme();
  const episodeId = route.params?.episodeId ?? null;
  const supabase = useMemo(() => getMobileSupabaseClient(), []);
  const [mealTag, setMealTag] = useState<MealTag | null>(null);
  const [foodNote, setFoodNote] = useState('');
  const [loggedDate, setLoggedDate] = useState(currentLocalDate);
  const [loggedTime, setLoggedTime] = useState(currentLocalTime);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loggedAtValue = useMemo(() => {
    const iso = localDateTimeToIso(loggedDate, loggedTime);
    return iso ? new Date(iso) : new Date();
  }, [loggedDate, loggedTime]);

  const loggedDateLabel = useMemo(() => {
    return loggedAtValue.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }, [loggedAtValue]);

  const loggedTimeLabel = useMemo(() => {
    return loggedAtValue.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }, [loggedAtValue]);

  const onDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setDatePickerOpen(false);
    }
    if (event.type === 'dismissed') {
      return;
    }
    if (!selectedDate) {
      return;
    }
    setLoggedDate(localDateFromDate(selectedDate));
  };

  const onTimeChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setTimePickerOpen(false);
    }
    if (event.type === 'dismissed') {
      return;
    }
    if (!selectedDate) {
      return;
    }
    setLoggedTime(localTimeFromDate(selectedDate));
  };

  const onSave = async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      const message = 'You must be signed in to save a food diary entry.';
      setErrorMessage(message);
      await announce(message, { politeness: 'assertive' });
      setSaving(false);
      return;
    }

    const loggedAtIso = localDateTimeToIso(loggedDate, loggedTime);
    if (!loggedAtIso) {
      const message = 'Enter a valid date and time.';
      setErrorMessage(message);
      await announce(message, { politeness: 'assertive' });
      setSaving(false);
      return;
    }
    if (!mealTag) {
      const message = 'Choose a meal tag.';
      setErrorMessage(message);
      await announce(message, { politeness: 'assertive' });
      setSaving(false);
      return;
    }

    const result = await createFoodDiaryEntry(supabase, {
      user_id: user.id,
      episode_id: episodeId,
      meal_tag: mealTag,
      food_note: foodNote,
      logged_at: loggedAtIso,
    });
    setSaving(false);
    if (!result.ok) {
      setErrorMessage(result.error.message);
      await announce(result.error.message, { politeness: 'assertive' });
      return;
    }

    setMealTag(null);
    setFoodNote('');
    setLoggedDate(currentLocalDate());
    setLoggedTime(currentLocalTime());
    setDatePickerOpen(false);
    setTimePickerOpen(false);
    setSuccessMessage(
      episodeId
        ? 'Food entry saved and linked to this episode.'
        : 'Food entry saved.',
    );
    await announce('Food entry saved.', { politeness: 'polite' });
  };

  return (
    <ScreenShell contentAlign="stretch">
      <View className="min-h-0 flex-1 gap-4">
        <Text
          accessibilityRole="header"
          className={`text-[22px] font-semibold ${nw.textInk}`}
          maxFontSizeMultiplier={2}
        >
          Food diary
        </Text>
        <Text
          className={`text-base leading-relaxed ${nw.textMuted}`}
          maxFontSizeMultiplier={2}
        >
          Log what you ate or drank. Time defaults to now and can be adjusted.
        </Text>

        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 24 }}
        >
          <Text
            className={`mb-2 text-base font-medium ${nw.textInk}`}
            maxFontSizeMultiplier={2}
          >
            Meal tag
          </Text>
          <View accessibilityLabel="Meal tag" className="mb-4 gap-2">
            {MEAL_TAGS.map((tag) => (
              <Pressable
                key={tag}
                accessibilityRole="button"
                accessibilityLabel={tag}
                accessibilityState={{
                  selected: mealTag === tag,
                  disabled: saving,
                }}
                disabled={saving}
                onPress={() => {
                  setMealTag((prev) => (prev === tag ? null : tag));
                }}
                style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                className={`w-full items-center justify-center rounded-xl border-2 px-3 py-3 dark:border-app-border-dark ${
                  mealTag === tag
                    ? 'border-red-700 bg-red-50 dark:border-red-500 dark:bg-red-950/40'
                    : 'border-app-border bg-app-bg dark:bg-app-bg-dark'
                }`}
              >
                <Text
                  className={`text-center text-[17px] font-semibold ${nw.textInk}`}
                  maxFontSizeMultiplier={2}
                >
                  {tag}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text
            className={`mb-1 text-base font-medium ${nw.textInk}`}
            maxFontSizeMultiplier={2}
          >
            Logged date
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Logged date"
            accessibilityState={{ disabled: saving }}
            disabled={saving}
            onPress={() => {
              setDatePickerOpen((prev) => !prev);
              setTimePickerOpen(false);
            }}
            style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
            className="mb-3 items-center justify-center rounded-xl border border-app-border bg-white px-4 py-3 dark:border-app-border-dark dark:bg-app-bg-dark"
          >
            <Text
              className={`text-[17px] ${nw.textInk}`}
              maxFontSizeMultiplier={2}
            >
              {loggedDateLabel}
            </Text>
          </Pressable>

          <Text
            className={`mb-1 text-base font-medium ${nw.textInk}`}
            maxFontSizeMultiplier={2}
          >
            Logged time
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Logged time"
            accessibilityState={{ disabled: saving }}
            disabled={saving}
            onPress={() => {
              setTimePickerOpen((prev) => !prev);
              setDatePickerOpen(false);
            }}
            style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
            className="mb-4 items-center justify-center rounded-xl border border-app-border bg-white px-4 py-3 dark:border-app-border-dark dark:bg-app-bg-dark"
          >
            <Text
              className={`text-[17px] ${nw.textInk}`}
              maxFontSizeMultiplier={2}
            >
              {loggedTimeLabel}
            </Text>
          </Pressable>

          <Text
            className={`mb-1 text-base font-medium ${nw.textInk}`}
            maxFontSizeMultiplier={2}
          >
            Food note
          </Text>
          <TextInput
            editable={!saving}
            accessibilityLabel="Food note"
            multiline
            value={foodNote}
            onChangeText={setFoodNote}
            placeholder="What did you eat or drink?"
            placeholderTextColor={colors.inputPlaceholder}
            className={`mb-4 min-h-[120px] rounded-xl border border-app-border bg-white p-4 text-[17px] text-app-ink dark:border-app-border-dark dark:bg-app-bg-dark ${nw.textInk}`}
            maxFontSizeMultiplier={2}
          />

          {errorMessage ? (
            <Text
              className={`mb-2 text-sm ${nw.textError}`}
              accessibilityLiveRegion="assertive"
              maxFontSizeMultiplier={2}
            >
              {errorMessage}
            </Text>
          ) : null}
          {successMessage ? (
            <Text
              className="mb-2 text-sm text-green-700 dark:text-green-300"
              accessibilityLiveRegion="polite"
              maxFontSizeMultiplier={2}
            >
              {successMessage}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              saving ? 'Saving food entry' : 'Save food entry'
            }
            accessibilityState={{ disabled: saving }}
            disabled={saving}
            onPress={() => {
              void onSave();
            }}
            style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
            className="w-full items-center justify-center rounded-xl bg-red-700 px-3 py-4 active:opacity-90 disabled:opacity-60 dark:bg-red-600"
          >
            <Text className="text-center text-[17px] font-semibold text-white">
              {saving ? 'Saving…' : 'Save food entry'}
            </Text>
          </Pressable>
        </ScrollView>
        {datePickerOpen ? (
          <DateTimePicker
            value={loggedAtValue}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={onDateChange}
          />
        ) : null}
        {timePickerOpen ? (
          <DateTimePicker
            value={loggedAtValue}
            mode="time"
            is24Hour={false}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={onTimeChange}
          />
        ) : null}
      </View>
    </ScreenShell>
  );
}
