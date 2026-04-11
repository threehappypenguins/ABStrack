/**
 * PRD §2 “Common ABS Symptom Suggestions” and “Uncommon ABS Symptom Suggestions” — used to seed
 * preset setup pick lists and datalist hints (web symptom preset management).
 */

/** Frequently suggested symptoms for ABS episode presets (PRD). */
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

/** Less common suggestions still relevant to ABS presentations (PRD). */
export const UNCOMMON_ABS_SYMPTOM_SUGGESTIONS = [
  'Hemiparesis',
  'Facial drooping',
  'Feelings of impending doom',
] as const;

/** All built-in suggestion strings for datalist / quick-pick UIs. */
export const ALL_ABS_SYMPTOM_SUGGESTIONS: readonly string[] = [
  ...COMMON_ABS_SYMPTOM_SUGGESTIONS,
  ...UNCOMMON_ABS_SYMPTOM_SUGGESTIONS,
];
