/**
 * PRD §2 “Common ABS Symptom Suggestions” — used to seed preset setup pick lists and datalist
 * hints (web symptom preset management).
 */

/** Built-in ABS symptom suggestion strings for datalist / quick-pick UIs. */
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

/** Same reference as {@link COMMON_ABS_SYMPTOM_SUGGESTIONS} for pick lists / datalist. */
export const ALL_ABS_SYMPTOM_SUGGESTIONS = COMMON_ABS_SYMPTOM_SUGGESTIONS;
