import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { MEAL_TAGS } from '@abstrack/types';
import { COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { AppThemeColors } from '../theme/app-colors';
import { nw } from '../theme/app-nativewind-classes';
import { EpisodeFlowSecondaryActionsSection } from '../components/episode-flow/EpisodeFlowSecondaryActionsSection';
import type { HealthMarkerFoodDiaryHookResult } from './use-health-marker-food-diary';

function formatFoodDiaryLoggedAtForDisplay(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) {
    return iso;
  }
  const dateStr = d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const timeStr = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${dateStr}, ${timeStr}`;
}

export type HealthMarkerFoodDiaryStepProps = {
  fd: HealthMarkerFoodDiaryHookResult;
  colors: AppThemeColors;
  onCancelEpisodePress: () => void;
};

export function HealthMarkerFoodDiaryStep({
  fd,
  colors,
  onCancelEpisodePress,
}: HealthMarkerFoodDiaryStepProps) {
  return (
    <>
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        <Text
          className={`mb-4 text-base leading-relaxed ${nw.textMuted}`}
          maxFontSizeMultiplier={2}
        >
          Add one or more meals/snacks for this episode, or skip this step.
        </Text>
        <Text
          accessibilityRole="header"
          className={`mb-2 text-lg font-semibold ${nw.textInk}`}
          maxFontSizeMultiplier={2}
        >
          Saved entries
        </Text>
        {fd.foodEntriesLoading ? (
          <Text
            className={`mb-2 text-sm ${nw.textMuted}`}
            accessibilityLiveRegion="polite"
            maxFontSizeMultiplier={2}
          >
            Loading entries…
          </Text>
        ) : null}
        {fd.foodEntriesError ? (
          <View className="mb-3">
            <Text
              className={`mb-2 text-sm ${nw.textError}`}
              accessibilityLiveRegion="assertive"
              maxFontSizeMultiplier={2}
            >
              {fd.foodEntriesError}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Try again to load food diary entries"
              accessibilityState={{ disabled: fd.foodEntriesLoading }}
              disabled={fd.foodEntriesLoading}
              onPress={() => {
                void fd.loadFoodEntries();
              }}
              style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
              className="w-full items-center justify-center rounded-lg border border-app-border px-3 py-3 active:opacity-80 disabled:opacity-50 dark:border-app-border-dark"
            >
              <Text
                className={`text-base font-medium ${nw.textInk}`}
                maxFontSizeMultiplier={2}
              >
                {fd.foodEntriesLoading ? 'Retrying…' : 'Try again'}
              </Text>
            </Pressable>
          </View>
        ) : null}
        {!fd.foodEntriesLoading &&
        !fd.foodEntriesError &&
        fd.foodEntries.length === 0 ? (
          <Text
            className={`mb-3 text-sm ${nw.textMuted}`}
            maxFontSizeMultiplier={2}
          >
            No food entries yet for this episode.
          </Text>
        ) : null}
        {fd.foodEntries.map((entry) => (
          <View
            key={entry.id}
            className="mb-3 rounded-xl border border-app-border bg-app-bg p-3 dark:border-app-border-dark dark:bg-app-bg-dark"
          >
            <Text
              className={`text-base font-semibold ${nw.textInk}`}
              maxFontSizeMultiplier={2}
            >
              {entry.meal_tag}
            </Text>
            <Text
              className={`mt-1 text-sm ${nw.textMuted}`}
              maxFontSizeMultiplier={2}
            >
              {formatFoodDiaryLoggedAtForDisplay(entry.logged_at)}
            </Text>
            <Text
              className={`mt-2 text-sm ${nw.textInk}`}
              maxFontSizeMultiplier={2}
            >
              {entry.food_note}
            </Text>
            {fd.editingFoodEntryId !== entry.id ? (
              <View className="mt-2 flex-row items-center justify-end gap-2">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${entry.meal_tag} food entry`}
                  onPress={() => {
                    fd.onEditFoodEntry(entry);
                  }}
                  style={{
                    minWidth: COMFORTABLE_TOUCH_TARGET_DP,
                    minHeight: COMFORTABLE_TOUCH_TARGET_DP,
                  }}
                  className="items-center justify-center rounded-lg border border-app-border px-2 active:opacity-80 dark:border-app-border-dark"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name="pencil-outline"
                    size={20}
                    color={colors.muted}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Discard ${entry.meal_tag} food entry`}
                  accessibilityState={{
                    disabled: fd.deletingFoodEntryId != null,
                  }}
                  disabled={fd.deletingFoodEntryId != null}
                  onPress={() => {
                    fd.onDeleteFoodEntry(entry.id);
                  }}
                  style={{
                    minWidth: COMFORTABLE_TOUCH_TARGET_DP,
                    minHeight: COMFORTABLE_TOUCH_TARGET_DP,
                  }}
                  className="items-center justify-center rounded-lg border border-red-400 px-2 active:opacity-80 disabled:opacity-60 dark:border-red-500/60"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  {fd.deletingFoodEntryId === entry.id ? (
                    <Text
                      className="text-xs font-semibold text-red-700 dark:text-red-300"
                      maxFontSizeMultiplier={2}
                    >
                      ...
                    </Text>
                  ) : (
                    <Ionicons
                      name="trash-outline"
                      size={20}
                      color={colors.error}
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    />
                  )}
                </Pressable>
              </View>
            ) : null}
            {fd.editingFoodEntryId === entry.id ? (
              <View className="mt-3 rounded-lg border border-app-border p-3 dark:border-app-border-dark">
                <Text
                  className={`mb-2 text-base font-semibold ${nw.textInk}`}
                  maxFontSizeMultiplier={2}
                >
                  Edit food entry
                </Text>
                <View accessibilityLabel="Meal tag" className="mb-3 gap-2">
                  {MEAL_TAGS.map((tag) => (
                    <Pressable
                      key={`${entry.id}-${tag}`}
                      accessibilityRole="button"
                      accessibilityLabel={tag}
                      accessibilityState={{
                        selected: fd.mealTag === tag,
                        disabled: fd.savingFoodDiary,
                      }}
                      disabled={fd.savingFoodDiary}
                      onPress={() => {
                        fd.setMealTag((prev) => (prev === tag ? null : tag));
                      }}
                      style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                      className={`w-full items-center justify-center rounded-xl border-2 px-3 py-3 dark:border-app-border-dark ${
                        fd.mealTag === tag
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
                  accessibilityState={{ disabled: fd.savingFoodDiary }}
                  disabled={fd.savingFoodDiary}
                  onPress={() => {
                    fd.setFoodDatePickerOpen((prev) => !prev);
                    fd.setFoodTimePickerOpen(false);
                  }}
                  style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                  className="mb-3 items-center justify-center rounded-xl border border-app-border bg-white px-4 py-3 dark:border-app-border-dark dark:bg-app-bg-dark"
                >
                  <Text
                    className={`text-[17px] ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    {fd.foodLoggedDateLabel}
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
                  accessibilityState={{ disabled: fd.savingFoodDiary }}
                  disabled={fd.savingFoodDiary}
                  onPress={() => {
                    fd.setFoodTimePickerOpen((prev) => !prev);
                    fd.setFoodDatePickerOpen(false);
                  }}
                  style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                  className="mb-4 items-center justify-center rounded-xl border border-app-border bg-white px-4 py-3 dark:border-app-border-dark dark:bg-app-bg-dark"
                >
                  <Text
                    className={`text-[17px] ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    {fd.foodLoggedTimeLabel}
                  </Text>
                </Pressable>
                <Text
                  className={`mb-1 text-base font-medium ${nw.textInk}`}
                  maxFontSizeMultiplier={2}
                >
                  Food note
                </Text>
                <TextInput
                  editable={!fd.savingFoodDiary}
                  accessibilityLabel="Food note"
                  multiline
                  value={fd.foodNote}
                  onChangeText={fd.setFoodNote}
                  placeholder="What did you eat or drink?"
                  placeholderTextColor={colors.inputPlaceholder}
                  className={`mb-4 min-h-[120px] rounded-xl border border-app-border bg-white p-4 text-[17px] text-app-ink dark:border-app-border-dark dark:bg-app-bg-dark ${nw.textInk}`}
                  maxFontSizeMultiplier={2}
                />
                {fd.foodDiaryFeedback ? (
                  <Text
                    className={`mb-2 text-sm ${nw.textError}`}
                    accessibilityLiveRegion="assertive"
                    maxFontSizeMultiplier={2}
                  >
                    {fd.foodDiaryFeedback}
                  </Text>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    fd.savingFoodDiary
                      ? 'Saving food diary entry'
                      : 'Update food entry'
                  }
                  accessibilityState={{ disabled: fd.savingFoodDiary }}
                  disabled={fd.savingFoodDiary}
                  onPress={() => {
                    void fd.onSaveFoodDiary();
                  }}
                  style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                  className="w-full items-center justify-center rounded-xl bg-red-700 px-3 py-4 active:opacity-90 disabled:opacity-60 dark:bg-red-600"
                >
                  <Text className="text-center text-[17px] font-semibold text-white">
                    {fd.savingFoodDiary ? 'Saving…' : 'Update entry'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel food entry edit"
                  onPress={fd.onDiscardFoodEditChanges}
                  style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                  className="mt-3 w-full items-center justify-center rounded-lg border border-app-border px-3 py-3 active:opacity-80 dark:border-app-border-dark"
                >
                  <Text
                    className={`text-base font-medium ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    Discard changes
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Discard saved food entry"
                  accessibilityState={{
                    disabled: fd.deletingFoodEntryId != null,
                  }}
                  disabled={fd.deletingFoodEntryId != null}
                  onPress={() => {
                    fd.onDeleteFoodEntry(entry.id);
                  }}
                  style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                  className="mt-3 w-full items-center justify-center rounded-lg border border-red-400 px-3 py-3 active:opacity-80 disabled:opacity-60 dark:border-red-500/60"
                >
                  <Text
                    className="text-base font-medium text-red-700 dark:text-red-300"
                    maxFontSizeMultiplier={2}
                  >
                    {fd.deletingFoodEntryId === entry.id
                      ? 'Discarding…'
                      : 'Discard entry'}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ))}
        {fd.editingFoodEntryId == null && !fd.isAddFoodEntryOpen ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add food entry"
            onPress={fd.onNewFoodEntry}
            style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
            className="w-full items-center justify-center rounded-lg border border-app-border px-3 py-3 active:opacity-80 dark:border-app-border-dark"
          >
            <Text
              className={`text-base font-medium ${nw.textInk}`}
              maxFontSizeMultiplier={2}
            >
              Add food entry
            </Text>
          </Pressable>
        ) : null}
        {fd.editingFoodEntryId == null && fd.isAddFoodEntryOpen ? (
          <>
            <Text
              accessibilityRole="header"
              className={`mb-2 text-lg font-semibold ${nw.textInk}`}
              maxFontSizeMultiplier={2}
            >
              Add food entry
            </Text>
            <View accessibilityLabel="Meal tag" className="mb-4 gap-2">
              {MEAL_TAGS.map((tag) => (
                <Pressable
                  key={`add-${tag}`}
                  accessibilityRole="button"
                  accessibilityLabel={tag}
                  accessibilityState={{
                    selected: fd.mealTag === tag,
                    disabled: fd.savingFoodDiary,
                  }}
                  disabled={fd.savingFoodDiary}
                  onPress={() => {
                    const nextMealTag = fd.mealTag === tag ? null : tag;
                    fd.setMealTag(nextMealTag);
                    fd.setIsAddFoodEntryDirty(
                      fd.computeIsAddFoodEntryDirty({
                        mealTag: nextMealTag,
                        foodNote: fd.foodNote,
                        foodLoggedDate: fd.foodLoggedDate,
                        foodLoggedTime: fd.foodLoggedTime,
                      }),
                    );
                  }}
                  style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                  className={`w-full items-center justify-center rounded-xl border-2 px-3 py-3 dark:border-app-border-dark ${
                    fd.mealTag === tag
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
              accessibilityState={{ disabled: fd.savingFoodDiary }}
              disabled={fd.savingFoodDiary}
              onPress={() => {
                fd.setFoodDatePickerOpen((prev) => !prev);
                fd.setFoodTimePickerOpen(false);
              }}
              style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
              className="mb-3 items-center justify-center rounded-xl border border-app-border bg-white px-4 py-3 dark:border-app-border-dark dark:bg-app-bg-dark"
            >
              <Text
                className={`text-[17px] ${nw.textInk}`}
                maxFontSizeMultiplier={2}
              >
                {fd.foodLoggedDateLabel}
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
              accessibilityState={{ disabled: fd.savingFoodDiary }}
              disabled={fd.savingFoodDiary}
              onPress={() => {
                fd.setFoodTimePickerOpen((prev) => !prev);
                fd.setFoodDatePickerOpen(false);
              }}
              style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
              className="mb-4 items-center justify-center rounded-xl border border-app-border bg-white px-4 py-3 dark:border-app-border-dark dark:bg-app-bg-dark"
            >
              <Text
                className={`text-[17px] ${nw.textInk}`}
                maxFontSizeMultiplier={2}
              >
                {fd.foodLoggedTimeLabel}
              </Text>
            </Pressable>
            <Text
              className={`mb-1 text-base font-medium ${nw.textInk}`}
              maxFontSizeMultiplier={2}
            >
              Food note
            </Text>
            <TextInput
              editable={!fd.savingFoodDiary}
              accessibilityLabel="Food note"
              multiline
              value={fd.foodNote}
              onChangeText={(value) => {
                fd.setFoodNote(value);
                fd.setIsAddFoodEntryDirty(
                  fd.computeIsAddFoodEntryDirty({
                    mealTag: fd.mealTag,
                    foodNote: value,
                    foodLoggedDate: fd.foodLoggedDate,
                    foodLoggedTime: fd.foodLoggedTime,
                  }),
                );
              }}
              placeholder="What did you eat or drink?"
              placeholderTextColor={colors.inputPlaceholder}
              className={`mb-4 min-h-[120px] rounded-xl border border-app-border bg-white p-4 text-[17px] text-app-ink dark:border-app-border-dark dark:bg-app-bg-dark ${nw.textInk}`}
              maxFontSizeMultiplier={2}
            />
            {fd.foodDiaryFeedback ? (
              <Text
                className={`mb-2 text-sm ${nw.textError}`}
                accessibilityLiveRegion="assertive"
                maxFontSizeMultiplier={2}
              >
                {fd.foodDiaryFeedback}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                fd.savingFoodDiary
                  ? 'Saving food diary entry'
                  : 'Save food entry'
              }
              accessibilityState={{ disabled: fd.savingFoodDiary }}
              disabled={fd.savingFoodDiary}
              onPress={() => {
                void fd.onSaveFoodDiary();
              }}
              style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
              className="w-full items-center justify-center rounded-xl bg-red-700 px-3 py-4 active:opacity-90 disabled:opacity-60 dark:bg-red-600"
            >
              <Text className="text-center text-[17px] font-semibold text-white">
                {fd.savingFoodDiary ? 'Saving…' : 'Save entry'}
              </Text>
            </Pressable>
            {fd.isAddFoodEntryDirty ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Discard food entry"
                onPress={fd.onDiscardAddFoodDraft}
                style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                className="mt-3 w-full items-center justify-center rounded-lg border border-red-400 px-3 py-3 active:opacity-80 dark:border-red-500/60"
              >
                <Text
                  className="text-base font-medium text-red-700 dark:text-red-300"
                  maxFontSizeMultiplier={2}
                >
                  Discard entry
                </Text>
              </Pressable>
            ) : null}
            {!fd.isAddFoodEntryDirty ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Collapse add food entry"
                onPress={() => {
                  fd.setIsAddFoodEntryOpen(false);
                }}
                style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                className="mt-3 w-full items-center justify-center rounded-lg border border-app-border px-3 py-3 active:opacity-80 dark:border-app-border-dark"
              >
                <Text
                  className={`text-base font-medium ${nw.textInk}`}
                  maxFontSizeMultiplier={2}
                >
                  Collapse
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to health markers"
          onPress={() => {
            void fd.onBackFromFoodDiary();
          }}
          style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
          className="w-full items-center justify-center rounded-lg border border-app-border px-3 py-3 active:opacity-80 dark:border-app-border-dark"
        >
          <Text
            className={`text-base font-medium ${nw.textInk}`}
            maxFontSizeMultiplier={2}
          >
            Back
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            fd.foodEntries.length === 0
              ? 'Skip food diary entry'
              : 'Continue after food diary'
          }
          accessibilityState={{ disabled: fd.foodDiaryContinueDisabled }}
          disabled={fd.foodDiaryContinueDisabled}
          onPress={() => {
            void fd.onContinueFromFoodDiary();
          }}
          style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
          className={`w-full items-center justify-center rounded-lg bg-red-700 px-3 py-3 active:opacity-90 dark:bg-red-600 ${
            fd.foodDiaryContinueDisabled ? 'opacity-50' : ''
          } ${
            fd.editingFoodEntryId == null && !fd.isAddFoodEntryOpen
              ? 'mt-5'
              : 'mt-3'
          }`}
        >
          <Text
            className="text-center text-base font-semibold text-white"
            maxFontSizeMultiplier={2}
          >
            {fd.foodEntries.length === 0 ? 'Skip for now' : 'Continue'}
          </Text>
        </Pressable>
        <EpisodeFlowSecondaryActionsSection>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel episode"
            onPress={onCancelEpisodePress}
            style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
            className="w-full items-center justify-center rounded-lg px-3 py-3 active:opacity-80"
          >
            <Text
              className="text-sm font-medium text-red-700 dark:text-red-300"
              maxFontSizeMultiplier={2}
            >
              Cancel episode
            </Text>
          </Pressable>
        </EpisodeFlowSecondaryActionsSection>
      </ScrollView>
      {fd.foodDatePickerOpen ? (
        <DateTimePicker
          value={fd.foodLoggedDateTimeValue}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={fd.onFoodDatePickerChange}
        />
      ) : null}
      {fd.foodTimePickerOpen ? (
        <DateTimePicker
          value={fd.foodLoggedDateTimeValue}
          mode="time"
          is24Hour={false}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={fd.onFoodTimePickerChange}
        />
      ) : null}
    </>
  );
}
