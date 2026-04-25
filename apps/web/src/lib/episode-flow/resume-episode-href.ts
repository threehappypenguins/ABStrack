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
 * Symptom resumes include `resume=1` so the symptom flow hydrates merged server + session answers;
 * the step index itself is not encoded in the URL. Episode-hub resumes go directly to
 * `/check-in-saved` and do not require resume query flags.
 *
 * @param episodeId - `episodes.id`.
 * @param symptomPresetId - `symptom_presets.id` on the episode row; required for symptom resumes and nullable only when `options.toEpisodeHub` is true.
 * @param options - Optional destination override.
 * @returns Path under `/episode/[id]/symptoms` or `/episode/[id]/check-in-saved`.
 */
export function buildResumeEpisodeHref(
  episodeId: string,
  symptomPresetId: string | null,
  options: BuildResumeEpisodeHrefOptions = {},
): string {
  if (options.toEpisodeHub) {
    return `/episode/${episodeId}/check-in-saved`;
  }
  if (!symptomPresetId) {
    throw new Error(
      'buildResumeEpisodeHref requires symptomPresetId when resuming to symptoms.',
    );
  }
  const q = new URLSearchParams();
  q.set('resume', '1');
  q.set('symptomPresetId', symptomPresetId);
  return `/episode/${episodeId}/symptoms?${q.toString()}`;
}
