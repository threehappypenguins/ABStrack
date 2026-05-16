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
import {
  compareEpisodeTimelineItems,
  episodeTimelineBloodPressureDetailWithOptionalNotes,
  episodeTimelineBoundedFoodNote,
  episodeTimelineBoundedSymptomMarkerText,
  episodeTimelineMeasurementDetailWithOptionalNotes,
  type EpisodeTimelineItem,
} from './episode-observation-timeline-core.js';

export {
  compareEpisodeTimelineItems,
  EPISODE_TIMELINE_FOOD_NOTE_DETAIL_MAX_RUN,
  EPISODE_TIMELINE_SYMPTOM_MARKER_DETAIL_MAX_RUN,
  episodeTimelineBloodPressureDetailWithOptionalNotes,
  episodeTimelineBoundedFoodNote,
  episodeTimelineBoundedSymptomMarkerText,
  episodeTimelineMeasurementDetailWithOptionalNotes,
  upsertEpisodeTimelineItem,
} from './episode-observation-timeline-core.js';

export type { EpisodeTimelineItem } from './episode-observation-timeline-core.js';

/** Max rows pulled per observation source when building one episode timeline (symptoms / markers / food). */
export const EPISODE_TIMELINE_SOURCE_LIMIT = 200;

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
