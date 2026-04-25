import {
  PRESET_HEALTH_MARKER_KIND_LABELS,
  type HealthMarkerRow,
  type Uuid,
} from '@abstrack/types';
import type { PresetDataResult } from './preset-data.js';
import { wrap } from './preset-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';
import { listEpisodeHealthMarkersForEpisode } from './episode-health-marker-data.js';
import { listEpisodeSymptomsForEpisode } from './episode-symptom-data.js';
import { listFoodDiaryEntriesForEpisode } from './food-diary-data.js';

/**
 * One row in a merged, time-ordered episode view (symptoms, health markers, food).
 */
export type EpisodeTimelineItem = {
  kind: 'symptom' | 'health_marker' | 'food';
  /** ISO string used for ordering (`created_at` / `recorded_at` / `logged_at`). */
  sortAt: string;
  id: string;
  label: string;
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
  if (kind in PRESET_HEALTH_MARKER_KIND_LABELS) {
    return PRESET_HEALTH_MARKER_KIND_LABELS[
      kind as keyof typeof PRESET_HEALTH_MARKER_KIND_LABELS
    ];
  }
  return custom && custom.length > 0 ? custom : kind;
}

function compareTimeline(
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
 * Loads episode-tied symptoms, health markers, and up to 200 episode-tied food entries (newest
 * food rows from the source query) and returns them in one merged list ordered by product
 * timestamps (oldest first, `id` as tie-breaker) — a minimal “history” surface.
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
      listEpisodeSymptomsForEpisode(client, episodeId),
      listFoodDiaryEntriesForEpisode(client, episodeId, { limit: 200 }),
    ]);
    const hm =
      options.prefetchedHealthMarkers != null
        ? ({ ok: true, data: options.prefetchedHealthMarkers } as const)
        : await listEpisodeHealthMarkersForEpisode(client, episodeId);
    if (!sy.ok) {
      return { data: null, error: sy.error };
    }
    if (!hm.ok) {
      return { data: null, error: hm.error };
    }
    if (!fd.ok) {
      return { data: null, error: fd.error };
    }
    const items: EpisodeTimelineItem[] = [];

    for (const s of sy.data) {
      if (!s.preset_symptom_id) {
        continue;
      }
      let detail = '—';
      if (s.response_type === 'yes_no' && s.response_boolean != null) {
        detail = s.response_boolean ? 'Yes' : 'No';
      } else if (
        s.response_type === 'severity_scale' &&
        s.response_severity != null
      ) {
        detail = `Severity ${s.response_severity}`;
      } else if (s.response_type === 'free_text' && s.response_text) {
        const t = s.response_text.trim();
        detail = t.length > 80 ? `${t.slice(0, 77)}…` : t;
      } else if (s.response_type === 'photo') {
        detail = 'Photo';
      } else if (s.response_type === 'video') {
        detail = 'Video';
      }
      items.push({
        kind: 'symptom',
        sortAt: s.created_at,
        id: s.id,
        label: s.symptom_name,
        detail,
      });
    }

    for (const m of hm.data) {
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
          detail = n.length > 80 ? `${n.slice(0, 77)}…` : n;
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

    for (const f of fd.data) {
      const note = f.food_note.trim();
      items.push({
        kind: 'food',
        sortAt: f.logged_at,
        id: f.id,
        label: f.meal_tag,
        detail: note.length > 100 ? `${note.slice(0, 97)}…` : note,
      });
    }

    items.sort(compareTimeline);
    return { data: items, error: null };
  });
}
