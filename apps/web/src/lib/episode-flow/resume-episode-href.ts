/**
 * Builds the `/episode/[id]/symptoms` URL for continuing an active episode: `symptomPresetId`
 * selects the preset, and `resume=1` tells the symptom prompt flow to hydrate with resume logic.
 * The step index is **not** in the query string; it is computed in the flow from merged server +
 * session answers (and related resume handling).
 *
 * @param episodeId - `episodes.id`.
 * @param symptomPresetId - `symptom_presets.id` on the episode row.
 * @returns Path under `/episode/[id]/symptoms`.
 */
export function buildResumeEpisodeHref(
  episodeId: string,
  symptomPresetId: string,
): string {
  const q = new URLSearchParams();
  q.set('symptomPresetId', symptomPresetId);
  q.set('resume', '1');
  return `/episode/${episodeId}/symptoms?${q.toString()}`;
}
