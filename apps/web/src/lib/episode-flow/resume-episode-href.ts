export type BuildResumeEpisodeHrefOptions = {
  /**
   * When true, resume enters `/health-markers` directly. Use this for episodes that already
   * completed post-marker details and only need explicit ending.
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
 * @returns Path under `/episode/[id]/symptoms` or `/episode/[id]/health-markers`.
 */
export function buildResumeEpisodeHref(
  episodeId: string,
  symptomPresetId: string | null,
  options: BuildResumeEpisodeHrefOptions = {},
): string {
  const q = new URLSearchParams();
  q.set('resume', '1');
  if (options.toHealthMarkers) {
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
