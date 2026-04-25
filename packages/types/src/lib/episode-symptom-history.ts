import type { EpisodeSymptomRow } from './types.js';

/**
 * Compares episode symptom rows for deterministic history order: oldest timestamp first, then
 * `id` ascending as a stable tie-breaker.
 *
 * @param a - Left symptom row.
 * @param b - Right symptom row.
 * @returns Negative when `a` should render before `b`.
 */
export function compareEpisodeSymptomRowsForHistory(
  a: EpisodeSymptomRow,
  b: EpisodeSymptomRow,
): number {
  const aMs = Date.parse(a.created_at);
  const bMs = Date.parse(b.created_at);
  const aValid = Number.isFinite(aMs);
  const bValid = Number.isFinite(bMs);
  if (aValid && bValid) {
    const byTime = aMs - bMs;
    if (byTime !== 0) {
      return byTime;
    }
  } else {
    const byText = a.created_at.localeCompare(b.created_at);
    if (byText !== 0) {
      return byText;
    }
  }
  return a.id.localeCompare(b.id);
}

/**
 * Formats one `episode_symptoms` row into a concise human-readable detail string for history UIs.
 *
 * @param row - Symptom row to describe.
 * @returns Display-ready detail text.
 */
export function formatEpisodeSymptomHistoryDetail(
  row: EpisodeSymptomRow,
): string {
  if (row.response_type === 'yes_no' && row.response_boolean != null) {
    return row.response_boolean ? 'Yes' : 'No';
  }
  if (row.response_type === 'severity_scale' && row.response_severity != null) {
    return `Severity ${row.response_severity}`;
  }
  if (row.response_type === 'free_text') {
    const text = row.response_text?.trim() ?? '';
    return text.length > 0 ? text : '—';
  }
  if (row.response_type === 'photo') {
    return 'Photo';
  }
  if (row.response_type === 'video') {
    return 'Video';
  }
  return '—';
}
