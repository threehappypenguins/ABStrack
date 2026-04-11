/**
 * PRD “Common ABS Symptom Suggestions” — same strings as web preset management; used for mobile
 * quick-pick cards when adding a symptom line.
 */

/** Built-in ABS symptom suggestion strings for suggestion-picker UIs. */
export const COMMON_ABS_SYMPTOM_SUGGESTIONS = [
  'Nausea',
  'Vomiting',
  'Vertigo',
  'Dizziness',
  'Slurred speech',
  'Brain fog / confusion',
  'Fatigue',
  'Headache',
  'Mood changes',
  'Anxiety',
] as const;

/** Alias for pick lists (same as {@link COMMON_ABS_SYMPTOM_SUGGESTIONS}). */
export const ALL_ABS_SYMPTOM_SUGGESTIONS: readonly string[] = [
  ...COMMON_ABS_SYMPTOM_SUGGESTIONS,
];
