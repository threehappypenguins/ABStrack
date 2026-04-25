import type {
  EpisodeSymptomRow,
  HealthMarkerRow,
  PresetHealthMarkerRow,
} from './types.js';

function isAfterPassBoundary(
  createdAt: string,
  lastPostMarkerStepCompletedAt: string,
): boolean {
  const createdAtMs = Date.parse(createdAt);
  const boundaryMs = Date.parse(lastPostMarkerStepCompletedAt);
  const createdAtIsValid = Number.isFinite(createdAtMs);
  const boundaryIsValid = Number.isFinite(boundaryMs);
  if (createdAtIsValid && boundaryIsValid) {
    return createdAtMs > boundaryMs;
  }
  // Defensive fallback for unexpected timestamp serialization.
  return createdAt > lastPostMarkerStepCompletedAt;
}

function compareTimestampDesc(a: string, b: string): number {
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  const aValid = Number.isFinite(aMs);
  const bValid = Number.isFinite(bMs);
  if (aValid && bValid) {
    return bMs - aMs;
  }
  // Defensive fallback for unexpected timestamp serialization.
  return b.localeCompare(a);
}

/**
 * Returns episode symptom rows that belong to the **open pass** after the last time the user
 * finished the episode-details step (Save and continue). When that timestamp is null, the whole
 * history is in one “first pass” context and nothing is filtered out.
 *
 * @param rows - All `episode_symptoms` rows for the episode (any sort order).
 * @param lastPostMarkerStepCompletedAt - `episodes.post_marker_step_completed_at` (ISO), or null.
 */
export function filterEpisodeSymptomRowsForOpenPass(
  rows: EpisodeSymptomRow[],
  lastPostMarkerStepCompletedAt: string | null,
): EpisodeSymptomRow[] {
  if (lastPostMarkerStepCompletedAt == null) {
    return rows;
  }
  return rows.filter((r) =>
    isAfterPassBoundary(r.created_at, lastPostMarkerStepCompletedAt),
  );
}

/**
 * Same as {@link filterEpisodeSymptomRowsForOpenPass} for `health_markers` rows, using
 * `created_at` to align with when the row was written (not `recorded_at`, so backdated vitals
 * still belong to the pass in which they were saved).
 *
 * @param rows - All episode-bound `health_markers` rows (wellness rows should be omitted by caller).
 * @param lastPostMarkerStepCompletedAt - `episodes.post_marker_step_completed_at` (ISO), or null.
 */
export function filterHealthMarkerRowsForOpenPass(
  rows: HealthMarkerRow[],
  lastPostMarkerStepCompletedAt: string | null,
): HealthMarkerRow[] {
  if (lastPostMarkerStepCompletedAt == null) {
    return rows;
  }
  return rows.filter((r) =>
    isAfterPassBoundary(r.created_at, lastPostMarkerStepCompletedAt),
  );
}

/**
 * Picks the latest marker row for a preset line within an already pass-filtered list
 * (newest `recorded_at`, then `created_at`, then `id`).
 *
 * @param passRows - Episode health markers in the current pass (see {@link filterHealthMarkerRowsForOpenPass}).
 * @param line - Preset line (`preset_health_markers.id` matches `preset_health_marker_id`).
 */
export function findLatestHealthMarkerForLineInPass(
  passRows: HealthMarkerRow[],
  line: PresetHealthMarkerRow,
): HealthMarkerRow | null {
  const forLine = passRows.filter((r) => r.preset_health_marker_id === line.id);
  if (forLine.length === 0) {
    return null;
  }
  forLine.sort((a, b) => {
    const c = compareTimestampDesc(a.recorded_at, b.recorded_at);
    if (c !== 0) {
      return c;
    }
    const d = compareTimestampDesc(a.created_at, b.created_at);
    if (d !== 0) {
      return d;
    }
    return b.id.localeCompare(a.id);
  });
  return forLine[0] ?? null;
}
