/**
 * PRD “Common ABS Symptom Suggestions” — shared by mobile and web symptom preset UIs (quick-pick
 * cards, datalist hints).
 */

/** Built-in ABS symptom suggestion strings. */
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

/**
 * Same reference as {@link COMMON_ABS_SYMPTOM_SUGGESTIONS} for pick lists and datalist options.
 */
export const ALL_ABS_SYMPTOM_SUGGESTIONS = COMMON_ABS_SYMPTOM_SUGGESTIONS;
