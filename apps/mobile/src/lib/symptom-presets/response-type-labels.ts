import type { SymptomResponseType } from '@abstrack/types';

const LABELS: Record<SymptomResponseType, string> = {
  yes_no: 'Yes / No',
  severity_scale: 'Severity (1–5)',
  free_text: 'Free text',
  photo: 'Photo',
  video: 'Video',
};

/**
 * Short labels for each {@link SymptomResponseType} in management UIs.
 *
 * @param type - Stored `preset_symptoms.response_type` value.
 * @returns Human-readable label for summaries and radio lists.
 */
export function getSymptomResponseTypeLabel(type: SymptomResponseType): string {
  return LABELS[type];
}
