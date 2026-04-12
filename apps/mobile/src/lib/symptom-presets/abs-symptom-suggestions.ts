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

/** Same reference as {@link COMMON_ABS_SYMPTOM_SUGGESTIONS} for pick lists. */
export const ALL_ABS_SYMPTOM_SUGGESTIONS = COMMON_ABS_SYMPTOM_SUGGESTIONS;
