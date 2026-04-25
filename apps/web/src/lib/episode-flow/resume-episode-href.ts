export type BuildResumeEpisodeHrefOptions = {
  /**
   * When true, resume enters `/health-markers` with `hub=1`: the episode hub (dashboard / another
   * check-in / end), not the marker stepper. Use when `post_marker_step_completed_at` is set.
   */
  toHealthMarkers?: boolean;
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
 * @returns Path under `/episode/[id]/symptoms` or `/episode/[id]/health-markers` (with `hub=1`
 * when resuming to the episode hub after a completed pass).
 */
export function buildResumeEpisodeHref(
  episodeId: string,
  symptomPresetId: string | null,
  options: BuildResumeEpisodeHrefOptions = {},
): string {
  const q = new URLSearchParams();
  q.set('resume', '1');
  if (options.toHealthMarkers) {
    q.set('hub', '1');
    return `/episode/${episodeId}/health-markers?${q.toString()}`;
  }
  if (!symptomPresetId) {
    throw new Error(
      'buildResumeEpisodeHref requires symptomPresetId when resuming to symptoms.',
    );
  }
  q.set('symptomPresetId', symptomPresetId);
  return `/episode/${episodeId}/symptoms?${q.toString()}`;
}
