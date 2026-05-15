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
 * One row in a merged, time-ordered episode view (symptoms, health markers, food).
 */
export type EpisodeTimelineItem = {
  kind: 'symptom' | 'health_marker' | 'food';
  /** ISO string used for ordering (`created_at` / `recorded_at` / `logged_at`). */
  sortAt: string;
  id: string;
  label: string;
  /**
   * Human-readable observation payload. Notes and free-text answers are kept in full here;
   * UI surfaces should clamp or expand visually rather than truncating in merge helpers.
   */
  detail: string;
};

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
    if (s.response_type === 'yes_no' && s.response_boolean != null) {
      detail = s.response_boolean ? 'Yes' : 'No';
    } else if (
      s.response_type === 'severity_scale' &&
      s.response_severity != null
    ) {
      detail = `Severity ${s.response_severity}`;
    } else if (s.response_type === 'free_text' && s.response_text) {
      detail = s.response_text.trim();
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
    });
  }
}

function pushHealthMarkerRowsToTimelineItems(
  items: EpisodeTimelineItem[],
  rows: HealthMarkerRow[],
): void {
  for (const m of rows) {
    let detail = '—';
    if (m.marker_kind === 'blood_pressure') {
      if (m.systolic_numeric != null && m.diastolic_numeric != null) {
        detail = `${m.systolic_numeric}/${m.diastolic_numeric}`;
      }
    } else if (m.value_numeric != null) {
      detail = String(m.value_numeric);
      if (m.custom_unit) {
        detail = `${detail} ${m.custom_unit}`;
      } else if (m.marker_kind === 'bac') {
        detail = `${detail} g/dL`;
      }
    } else {
      const n = m.notes?.trim();
      if (n) {
        detail = n;
      }
    }
    const kindLabel = healthMarkerTimelineLabel(m.marker_kind, m.custom_name);
    items.push({
      kind: 'health_marker',
      sortAt: m.recorded_at,
      id: m.id,
      label: kindLabel,
      detail,
    });
  }
}

function pushFoodDiaryRowsToTimelineItems(
  items: EpisodeTimelineItem[],
  rows: FoodDiaryEntryRow[],
): void {
  for (const f of rows) {
    const note = f.food_note.trim();
    items.push({
      kind: 'food',
      sortAt: f.logged_at,
      id: f.id,
      label: f.meal_tag,
      detail: note,
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
 * @returns Sorted timeline rows.
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
