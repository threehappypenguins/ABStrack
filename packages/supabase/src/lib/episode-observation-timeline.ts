import {
  PRESET_HEALTH_MARKER_KIND_LABELS,
  type EpisodeSymptomRow,
  type FoodDiaryEntryRow,
  type HealthMarkerRow,
  type Uuid,
} from '@abstrack/types';
import type { PresetDataResult } from './preset-data.js';
import { wrap } from './preset-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';
import { listEpisodeHealthMarkersForEpisode } from './episode-health-marker-data.js';
import { listEpisodeSymptomsForEpisode } from './episode-symptom-data.js';
import { listFoodDiaryEntriesForEpisode } from './food-diary-data.js';

/** Max rows pulled per observation source when building one episode timeline (symptoms / markers / food). */
export const EPISODE_TIMELINE_SOURCE_LIMIT = 200;

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

/**
 * Builds bounded timeline detail for a primary measurement line (for example `120/80`, `72`,
 * `0.08 g/dL`) plus optional {@link HealthMarkerRow.notes}. Uses the same cap as
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
 * Builds {@link EpisodeTimelineItem.detail} / {@link EpisodeTimelineItem.detailFull} for a blood
 * pressure systolic/diastolic pair plus optional {@link HealthMarkerRow.notes}. The combined string
 * uses the same length cap as {@link episodeTimelineBoundedSymptomMarkerText}.
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

function healthMarkerTimelineLabel(
  kind: string,
  customName: string | null,
): string {
  const custom = customName?.trim();
  if (kind === 'custom') {
    return custom && custom.length > 0
      ? custom
      : PRESET_HEALTH_MARKER_KIND_LABELS.custom;
  }
  if (kind === 'wellness_mood') {
    return 'Wellness mood';
  }
  if (Object.hasOwn(PRESET_HEALTH_MARKER_KIND_LABELS, kind)) {
    return PRESET_HEALTH_MARKER_KIND_LABELS[
      kind as keyof typeof PRESET_HEALTH_MARKER_KIND_LABELS
    ];
  }
  return custom && custom.length > 0 ? custom : kind;
}

function pushSymptomRowsToTimelineItems(
  items: EpisodeTimelineItem[],
  rows: EpisodeSymptomRow[],
): void {
  for (const s of rows) {
    const symptomLabel = s.symptom_name.trim();
    let detail = '—';
    let detailFull: string | undefined;
    if (s.response_type === 'yes_no' && s.response_boolean != null) {
      detail = s.response_boolean ? 'Yes' : 'No';
    } else if (
      s.response_type === 'severity_scale' &&
      s.response_severity != null
    ) {
      detail = `Severity ${s.response_severity}`;
    } else if (s.response_type === 'free_text' && s.response_text) {
      const bounded = episodeTimelineBoundedSymptomMarkerText(
        s.response_text.trim(),
      );
      detail = bounded.detail;
      detailFull = bounded.detailFull;
    } else if (s.response_type === 'photo') {
      detail = 'Photo';
    } else if (s.response_type === 'video') {
      detail = 'Video';
    }
    items.push({
      kind: 'symptom',
      sortAt: s.created_at,
      id: s.id,
      label: symptomLabel.length > 0 ? symptomLabel : 'Symptom entry',
      detail,
      ...(detailFull ? { detailFull } : {}),
    });
  }
}

function pushHealthMarkerRowsToTimelineItems(
  items: EpisodeTimelineItem[],
  rows: HealthMarkerRow[],
): void {
  for (const m of rows) {
    let detail = '—';
    let detailFull: string | undefined;
    if (m.marker_kind === 'blood_pressure') {
      if (m.systolic_numeric != null && m.diastolic_numeric != null) {
        const parts = episodeTimelineBloodPressureDetailWithOptionalNotes(
          m.systolic_numeric,
          m.diastolic_numeric,
          m.notes,
        );
        detail = parts.detail;
        detailFull = parts.detailFull;
      }
    } else if (m.value_numeric != null) {
      let measurement = String(m.value_numeric);
      if (m.custom_unit) {
        measurement = `${measurement} ${m.custom_unit}`;
      } else if (m.marker_kind === 'bac') {
        measurement = `${measurement} g/dL`;
      }
      const parts = episodeTimelineMeasurementDetailWithOptionalNotes(
        measurement,
        m.notes,
      );
      detail = parts.detail;
      detailFull = parts.detailFull;
    } else {
      const n = m.notes?.trim();
      if (n) {
        const bounded = episodeTimelineBoundedSymptomMarkerText(n);
        detail = bounded.detail;
        detailFull = bounded.detailFull;
      }
    }
    const kindLabel = healthMarkerTimelineLabel(m.marker_kind, m.custom_name);
    items.push({
      kind: 'health_marker',
      sortAt: m.recorded_at,
      id: m.id,
      label: kindLabel,
      detail,
      ...(detailFull ? { detailFull } : {}),
    });
  }
}

function pushFoodDiaryRowsToTimelineItems(
  items: EpisodeTimelineItem[],
  rows: FoodDiaryEntryRow[],
): void {
  for (const f of rows) {
    const note = f.food_note.trim();
    const bounded = episodeTimelineBoundedFoodNote(note);
    items.push({
      kind: 'food',
      sortAt: f.logged_at,
      id: f.id,
      label: f.meal_tag,
      detail: bounded.detail,
      ...(bounded.detailFull ? { detailFull: bounded.detailFull } : {}),
    });
  }
}

/**
 * Builds a merged, time-ordered list of symptom, health-marker, and food-diary observations for UI
 * surfaces (same ordering rules as {@link compareEpisodeTimelineItems}).
 *
 * @param symptoms - Episode symptom rows (uses `created_at` for ordering).
 * @param healthMarkers - Health marker rows (uses `recorded_at`).
 * @param foods - Food diary rows (uses `logged_at`).
 * @returns Sorted timeline rows. Long free-text, marker notes (including notes paired with blood
 *   pressure readings or numeric measurements), and food descriptions use bounded
 *   {@link EpisodeTimelineItem.detail} with optional {@link EpisodeTimelineItem.detailFull}.
 */
export function mergeEpisodeObservationRowsToTimeline(
  symptoms: EpisodeSymptomRow[],
  healthMarkers: HealthMarkerRow[],
  foods: FoodDiaryEntryRow[],
): EpisodeTimelineItem[] {
  const items: EpisodeTimelineItem[] = [];
  pushSymptomRowsToTimelineItems(items, symptoms);
  pushHealthMarkerRowsToTimelineItems(items, healthMarkers);
  pushFoodDiaryRowsToTimelineItems(items, foods);
  items.sort(compareEpisodeTimelineItems);
  return items;
}

/**
 * Standalone health markers and food diary rows (no episode), merged with the same ordering as
 * episode-bound timelines.
 *
 * @param healthMarkers - `episode_id IS NULL` health marker rows.
 * @param foods - Food diary rows with no episode link.
 * @returns Sorted timeline rows.
 */
export function mergeStandaloneHealthAndFoodRowsToTimeline(
  healthMarkers: HealthMarkerRow[],
  foods: FoodDiaryEntryRow[],
): EpisodeTimelineItem[] {
  const items: EpisodeTimelineItem[] = [];
  pushHealthMarkerRowsToTimelineItems(items, healthMarkers);
  pushFoodDiaryRowsToTimelineItems(items, foods);
  items.sort(compareEpisodeTimelineItems);
  return items;
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

/**
 * Loads a bounded recent slice of episode-tied symptoms, health markers, and food entries
 * (currently up to 200 from each source query) and returns them in one merged list ordered by
 * product timestamps (oldest first, `id` as tie-breaker) — a minimal “history” surface.
 *
 * @param client - Supabase client (RLS applies).
 * @param episodeId - `episodes.id`.
 */
export async function listEpisodeObservationTimeline(
  client: AbstrackSupabaseClient,
  episodeId: Uuid,
  options: {
    prefetchedHealthMarkers?: HealthMarkerRow[];
  } = {},
): Promise<PresetDataResult<EpisodeTimelineItem[]>> {
  return wrap(async () => {
    const [sy, fd] = await Promise.all([
      listEpisodeSymptomsForEpisode(client, episodeId, {
        limit: EPISODE_TIMELINE_SOURCE_LIMIT,
        orderBy: 'recent',
      }),
      listFoodDiaryEntriesForEpisode(client, episodeId, {
        limit: EPISODE_TIMELINE_SOURCE_LIMIT,
      }),
    ]);
    const hm =
      options.prefetchedHealthMarkers != null
        ? ({
            ok: true,
            data: options.prefetchedHealthMarkers.slice(
              0,
              EPISODE_TIMELINE_SOURCE_LIMIT,
            ),
          } as const)
        : await listEpisodeHealthMarkersForEpisode(client, episodeId, {
            limit: EPISODE_TIMELINE_SOURCE_LIMIT,
          });
    if (!sy.ok) {
      return { data: null, error: sy.error };
    }
    if (!hm.ok) {
      return { data: null, error: hm.error };
    }
    if (!fd.ok) {
      return { data: null, error: fd.error };
    }
    const items = mergeEpisodeObservationRowsToTimeline(
      sy.data,
      hm.data,
      fd.data,
    );
    return { data: items, error: null };
  });
}
