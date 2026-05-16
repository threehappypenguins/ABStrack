/**
 * Pure timeline presentation helpers (bounded `detail` text, ordering, in-memory upsert) shared by
 * {@link mergeEpisodeObservationRowsToTimeline} and client tests that `jest.requireActual` this
 * module without pulling PostgREST list helpers.
 */

/**
 * One row in a merged, time-ordered episode view (symptoms, health markers, food).
 */
export type EpisodeTimelineItem = {
  kind: 'symptom' | 'health_marker' | 'food';
  /** ISO string used for ordering (`created_at` / `recorded_at` / `logged_at`). */
  sortAt: string;
  id: string;
  label: string;
  /**
   * Inline-safe preview for compact lists (bounded for long free-text, marker notes, and food notes).
   * Use {@link detailFull} for the complete string when present.
   */
  detail: string;
  /** Full clinical or diary text when it was longer than the inline cap for this row kind. */
  detailFull?: string;
};

/**
 * Maximum length of {@link EpisodeTimelineItem.detail} for symptom free-text and health-marker
 * note-only rows when the source exceeds this cap (truncated `detail` is exactly this many code
 * units: a prefix of the source plus one ellipsis). Longer source text is previewed in `detail`
 * with {@link EpisodeTimelineItem.detailFull}.
 */
export const EPISODE_TIMELINE_SYMPTOM_MARKER_DETAIL_MAX_RUN = 80;

/**
 * Maximum length of {@link EpisodeTimelineItem.detail} for food diary notes when the source exceeds
 * this cap (truncated `detail` is exactly this many code units: a prefix plus one ellipsis). Longer
 * notes set {@link EpisodeTimelineItem.detailFull}.
 */
export const EPISODE_TIMELINE_FOOD_NOTE_DETAIL_MAX_RUN = 100;

/**
 * Ellipsis appended when {@link EpisodeTimelineItem.detail} truncates long source text. Length is
 * subtracted from the max-run constants so total `detail` length matches those caps.
 */
const EPISODE_TIMELINE_TRUNCATION_ELLIPSIS = '…';

/** Code units kept from source before {@link EPISODE_TIMELINE_TRUNCATION_ELLIPSIS} for symptom/marker notes. */
const EPISODE_TIMELINE_SYMPTOM_MARKER_DETAIL_PREVIEW_SLICE_LEN =
  EPISODE_TIMELINE_SYMPTOM_MARKER_DETAIL_MAX_RUN -
  EPISODE_TIMELINE_TRUNCATION_ELLIPSIS.length;

/** Code units kept from source before {@link EPISODE_TIMELINE_TRUNCATION_ELLIPSIS} for food notes. */
const EPISODE_TIMELINE_FOOD_NOTE_DETAIL_PREVIEW_SLICE_LEN =
  EPISODE_TIMELINE_FOOD_NOTE_DETAIL_MAX_RUN -
  EPISODE_TIMELINE_TRUNCATION_ELLIPSIS.length;

/**
 * Inline-safe {@link EpisodeTimelineItem.detail} (and optional {@link EpisodeTimelineItem.detailFull})
 * for symptom free-text or health-marker notes, matching merge helper rules.
 *
 * @param trimmed - Already-trimmed source text.
 */
export function episodeTimelineBoundedSymptomMarkerText(trimmed: string): {
  detail: string;
  detailFull?: string;
} {
  if (trimmed.length <= EPISODE_TIMELINE_SYMPTOM_MARKER_DETAIL_MAX_RUN) {
    return { detail: trimmed };
  }
  return {
    detail: `${trimmed.slice(0, EPISODE_TIMELINE_SYMPTOM_MARKER_DETAIL_PREVIEW_SLICE_LEN)}${EPISODE_TIMELINE_TRUNCATION_ELLIPSIS}`,
    detailFull: trimmed,
  };
}

/**
 * Inline-safe {@link EpisodeTimelineItem.detail} for food diary notes, matching merge helper rules.
 *
 * @param trimmed - Already-trimmed `food_note`.
 */
export function episodeTimelineBoundedFoodNote(trimmed: string): {
  detail: string;
  detailFull?: string;
} {
  if (trimmed.length <= EPISODE_TIMELINE_FOOD_NOTE_DETAIL_MAX_RUN) {
    return { detail: trimmed };
  }
  return {
    detail: `${trimmed.slice(0, EPISODE_TIMELINE_FOOD_NOTE_DETAIL_PREVIEW_SLICE_LEN)}${EPISODE_TIMELINE_TRUNCATION_ELLIPSIS}`,
    detailFull: trimmed,
  };
}

function combineMeasurementLineWithOptionalPatientNotes(
  measurementDetail: string,
  notes: string | null | undefined,
): {
  detail: string;
  detailFull?: string;
} {
  const n = notes?.trim();
  if (!n) {
    return { detail: measurementDetail };
  }
  const combined = `${measurementDetail} · ${n}`;
  return episodeTimelineBoundedSymptomMarkerText(combined);
}

/**
 * Builds bounded timeline detail for a primary measurement line (for example `120/80`, `72`,
 * `0.08 g/dL`) plus optional patient notes on the marker row. Uses the same cap as
 * {@link episodeTimelineBoundedSymptomMarkerText}.
 *
 * @param measurementDetail - Reading shown even when `notes` is empty (typically not `'—'`).
 * @param notes - Raw notes field from the marker row; trimmed; omitted when empty.
 * @returns Bounded {@link EpisodeTimelineItem.detail} / optional {@link EpisodeTimelineItem.detailFull}.
 */
export function episodeTimelineMeasurementDetailWithOptionalNotes(
  measurementDetail: string,
  notes: string | null | undefined,
): {
  detail: string;
  detailFull?: string;
} {
  return combineMeasurementLineWithOptionalPatientNotes(
    measurementDetail,
    notes,
  );
}

/**
 * Builds {@link EpisodeTimelineItem.detail} / {@link EpisodeTimelineItem.detailFull} for a blood
 * pressure systolic/diastolic pair plus optional notes. The combined string uses the same length cap
 * as {@link episodeTimelineBoundedSymptomMarkerText}.
 *
 * @param systolicNumeric - Stored systolic value (typically mmHg).
 * @param diastolicNumeric - Stored diastolic value (typically mmHg).
 * @param notes - Raw notes field from the marker row; trimmed; omitted from `detail` when empty.
 * @returns Bounded timeline detail shape for merged timelines and in-flow observation lists.
 */
export function episodeTimelineBloodPressureDetailWithOptionalNotes(
  systolicNumeric: number,
  diastolicNumeric: number,
  notes: string | null | undefined,
): {
  detail: string;
  detailFull?: string;
} {
  return combineMeasurementLineWithOptionalPatientNotes(
    `${systolicNumeric}/${diastolicNumeric}`,
    notes,
  );
}

/**
 * Compares two timeline items using the canonical merged-history ordering: oldest timestamp first,
 * then `id` as a stable tie-breaker.
 *
 * @param a - Left timeline item.
 * @param b - Right timeline item.
 * @returns Negative when `a` sorts before `b`.
 */
export function compareEpisodeTimelineItems(
  a: EpisodeTimelineItem,
  b: EpisodeTimelineItem,
): number {
  const aMs = Date.parse(a.sortAt);
  const bMs = Date.parse(b.sortAt);
  const aValid = Number.isFinite(aMs);
  const bValid = Number.isFinite(bMs);
  if (aValid && bValid) {
    const c = aMs - bMs;
    if (c !== 0) {
      return c;
    }
  } else {
    // Defensive fallback for unexpected timestamp serialization.
    const c = a.sortAt.localeCompare(b.sortAt);
    if (c !== 0) {
      return c;
    }
  }
  // Stable tie-break so merged timeline order is deterministic.
  return a.id.localeCompare(b.id);
}

/**
 * Inserts or replaces one timeline row in-memory and returns a canonically sorted copy.
 *
 * @param prev - Existing timeline rows.
 * @param next - Row to insert/replace by (`kind`, `id`).
 * @returns New sorted timeline rows.
 */
export function upsertEpisodeTimelineItem(
  prev: EpisodeTimelineItem[],
  next: EpisodeTimelineItem,
): EpisodeTimelineItem[] {
  const rows = prev.filter((r) => !(r.kind === next.kind && r.id === next.id));
  rows.push(next);
  rows.sort(compareEpisodeTimelineItems);
  return rows;
}
