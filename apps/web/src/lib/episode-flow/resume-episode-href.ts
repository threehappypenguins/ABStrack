export type BuildResumeEpisodeHrefOptions = {
  /**
   * When true, resume enters `/check-in-saved`: the episode hub (dashboard / another check-in /
   * end), not the marker stepper. Use when `post_marker_step_completed_at` is set.
   */
  toEpisodeHub?: boolean;
};

/**
 * Builds a resume URL for an active episode.
 *
 * `resume=1` tells flows to hydrate with resume logic. The symptom step index is not encoded in the
 * URL; the symptom flow computes it from merged server + session answers.
 *
 * @param episodeId - `episodes.id`.
 * @param symptomPresetId - `symptom_presets.id` on the episode row (ignored for health-marker resumes).
 * @param options - Optional destination override.
 * @returns Path under `/episode/[id]/symptoms` or `/episode/[id]/check-in-saved`.
 */
export function buildResumeEpisodeHref(
  episodeId: string,
  symptomPresetId: string | null,
  options: BuildResumeEpisodeHrefOptions = {},
): string {
  const q = new URLSearchParams();
  q.set('resume', '1');
  if (options.toEpisodeHub) {
    return `/episode/${episodeId}/check-in-saved`;
  }
  if (!symptomPresetId) {
    throw new Error(
      'buildResumeEpisodeHref requires symptomPresetId when resuming to symptoms.',
    );
  }
  q.set('symptomPresetId', symptomPresetId);
  return `/episode/${episodeId}/symptoms?${q.toString()}`;
}
