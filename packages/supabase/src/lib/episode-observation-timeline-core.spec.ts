import { describe, expect, it } from 'vitest';
import {
  compareEpisodeTimelineItems,
  EPISODE_TIMELINE_FOOD_NOTE_DETAIL_MAX_RUN,
  EPISODE_TIMELINE_SYMPTOM_MARKER_DETAIL_MAX_RUN,
  episodeTimelineBloodPressureDetailWithOptionalNotes,
  episodeTimelineBoundedFoodNote,
  episodeTimelineBoundedSymptomMarkerText,
  episodeTimelineMeasurementDetailWithOptionalNotes,
  type EpisodeTimelineItem,
} from './episode-observation-timeline-core.js';

/** Same character as {@link EPISODE_TIMELINE_TRUNCATION_ELLIPSIS} in the implementation (U+2026). */
const TRUNCATION_ELLIPSIS = '…';

describe('episodeTimelineBoundedSymptomMarkerText', () => {
  it('returns the full string with no detailFull at exactly the max run', () => {
    const atLimit = 'a'.repeat(EPISODE_TIMELINE_SYMPTOM_MARKER_DETAIL_MAX_RUN);
    expect(atLimit.length).toBe(EPISODE_TIMELINE_SYMPTOM_MARKER_DETAIL_MAX_RUN);
    expect(episodeTimelineBoundedSymptomMarkerText(atLimit)).toEqual({
      detail: atLimit,
    });
  });

  it('truncates to max run with ellipsis and sets detailFull when one code unit over the max', () => {
    const previewCodeUnits =
      EPISODE_TIMELINE_SYMPTOM_MARKER_DETAIL_MAX_RUN -
      TRUNCATION_ELLIPSIS.length;
    const full = `${'b'.repeat(EPISODE_TIMELINE_SYMPTOM_MARKER_DETAIL_MAX_RUN)}X`;
    expect(full.length).toBe(
      EPISODE_TIMELINE_SYMPTOM_MARKER_DETAIL_MAX_RUN + 1,
    );
    expect(episodeTimelineBoundedSymptomMarkerText(full)).toEqual({
      detail: `${'b'.repeat(previewCodeUnits)}${TRUNCATION_ELLIPSIS}`,
      detailFull: full,
    });
    expect(episodeTimelineBoundedSymptomMarkerText(full).detail.length).toBe(
      EPISODE_TIMELINE_SYMPTOM_MARKER_DETAIL_MAX_RUN,
    );
  });
});

describe('episodeTimelineBoundedFoodNote', () => {
  it('returns the full string with no detailFull at exactly the food max run', () => {
    const atLimit = 'c'.repeat(EPISODE_TIMELINE_FOOD_NOTE_DETAIL_MAX_RUN);
    expect(atLimit.length).toBe(EPISODE_TIMELINE_FOOD_NOTE_DETAIL_MAX_RUN);
    expect(episodeTimelineBoundedFoodNote(atLimit)).toEqual({
      detail: atLimit,
    });
  });

  it('truncates food notes using the food preview length and ellipsis', () => {
    const previewCodeUnits =
      EPISODE_TIMELINE_FOOD_NOTE_DETAIL_MAX_RUN - TRUNCATION_ELLIPSIS.length;
    const full = `${'d'.repeat(EPISODE_TIMELINE_FOOD_NOTE_DETAIL_MAX_RUN)}X`;
    expect(full.length).toBe(EPISODE_TIMELINE_FOOD_NOTE_DETAIL_MAX_RUN + 1);
    expect(episodeTimelineBoundedFoodNote(full)).toEqual({
      detail: `${'d'.repeat(previewCodeUnits)}${TRUNCATION_ELLIPSIS}`,
      detailFull: full,
    });
    expect(episodeTimelineBoundedFoodNote(full).detail.length).toBe(
      EPISODE_TIMELINE_FOOD_NOTE_DETAIL_MAX_RUN,
    );
  });
});

describe('episodeTimelineMeasurementDetailWithOptionalNotes', () => {
  const SEP = ' · ';

  it('returns measurement-only detail without truncation when notes are empty', () => {
    const longMeasurement = 'z'.repeat(120);
    expect(
      episodeTimelineMeasurementDetailWithOptionalNotes(longMeasurement, null),
    ).toEqual({ detail: longMeasurement });
  });

  it('bounds combined measurement and notes at exactly the symptom/marker max run', () => {
    const measurement = 'm'.repeat(40);
    const notes = 'n'.repeat(37);
    const combined = `${measurement}${SEP}${notes}`;
    expect(combined.length).toBe(
      EPISODE_TIMELINE_SYMPTOM_MARKER_DETAIL_MAX_RUN,
    );
    expect(
      episodeTimelineMeasurementDetailWithOptionalNotes(measurement, notes),
    ).toEqual({ detail: combined });
  });

  it('truncates combined measurement and notes when combined exceeds the max run', () => {
    const measurement = 'm'.repeat(40);
    const notes = 'n'.repeat(38);
    const combined = `${measurement}${SEP}${notes}`;
    expect(combined.length).toBe(
      EPISODE_TIMELINE_SYMPTOM_MARKER_DETAIL_MAX_RUN + 1,
    );
    const previewCodeUnits =
      EPISODE_TIMELINE_SYMPTOM_MARKER_DETAIL_MAX_RUN -
      TRUNCATION_ELLIPSIS.length;
    expect(
      episodeTimelineMeasurementDetailWithOptionalNotes(measurement, notes),
    ).toEqual({
      detail: `${combined.slice(0, previewCodeUnits)}${TRUNCATION_ELLIPSIS}`,
      detailFull: combined,
    });
  });
});

describe('episodeTimelineBloodPressureDetailWithOptionalNotes', () => {
  const SEP = ' · ';

  it('bounds combined BP reading and notes at exactly the symptom/marker max run', () => {
    const bp = '118/76';
    const notes = 'p'.repeat(
      EPISODE_TIMELINE_SYMPTOM_MARKER_DETAIL_MAX_RUN - bp.length - SEP.length,
    );
    const combined = `${bp}${SEP}${notes}`;
    expect(combined.length).toBe(
      EPISODE_TIMELINE_SYMPTOM_MARKER_DETAIL_MAX_RUN,
    );
    expect(
      episodeTimelineBloodPressureDetailWithOptionalNotes(118, 76, notes),
    ).toEqual({ detail: combined });
  });

  it('truncates combined BP reading and notes when combined exceeds the max run', () => {
    const bp = '118/76';
    const notes = 'q'.repeat(
      EPISODE_TIMELINE_SYMPTOM_MARKER_DETAIL_MAX_RUN -
        bp.length -
        SEP.length +
        1,
    );
    const combined = `${bp}${SEP}${notes}`;
    expect(combined.length).toBe(
      EPISODE_TIMELINE_SYMPTOM_MARKER_DETAIL_MAX_RUN + 1,
    );
    const previewCodeUnits =
      EPISODE_TIMELINE_SYMPTOM_MARKER_DETAIL_MAX_RUN -
      TRUNCATION_ELLIPSIS.length;
    expect(
      episodeTimelineBloodPressureDetailWithOptionalNotes(118, 76, notes),
    ).toEqual({
      detail: `${combined.slice(0, previewCodeUnits)}${TRUNCATION_ELLIPSIS}`,
      detailFull: combined,
    });
  });
});

function timelineItem(
  partial: Pick<EpisodeTimelineItem, 'id' | 'sortAt'> &
    Partial<Pick<EpisodeTimelineItem, 'kind' | 'label' | 'detail'>>,
): EpisodeTimelineItem {
  return {
    kind: 'symptom',
    label: 'Test',
    detail: '—',
    ...partial,
  };
}

describe('compareEpisodeTimelineItems', () => {
  it('orders parseable sortAt values by numeric instant', () => {
    const earlier = timelineItem({
      id: 'a',
      sortAt: '2026-04-24T12:00:00.023Z',
    });
    const later = timelineItem({
      id: 'b',
      sortAt: '2026-04-24T12:00:00.123+00:00',
    });
    expect(compareEpisodeTimelineItems(earlier, later)).toBeLessThan(0);
    expect(compareEpisodeTimelineItems(later, earlier)).toBeGreaterThan(0);
  });

  it('uses id as tie-breaker when parseable instants are equal', () => {
    const a = timelineItem({
      id: 'a-id',
      sortAt: '2026-04-24T12:00:00.000Z',
    });
    const b = timelineItem({
      id: 'b-id',
      sortAt: '2026-04-24T12:00:00+00:00',
    });
    expect(compareEpisodeTimelineItems(a, b)).toBeLessThan(0);
  });

  it('lexicographically orders rows when neither sortAt parses', () => {
    const a = timelineItem({ id: 'a', sortAt: 'not-a-date-a' });
    const b = timelineItem({ id: 'b', sortAt: 'not-a-date-b' });
    expect(compareEpisodeTimelineItems(a, b)).toBeLessThan(0);
  });

  it('places parseable sortAt before non-parseable without string/numeric mixing', () => {
    const valid = timelineItem({
      id: 'valid',
      sortAt: '2026-04-24T12:00:00.000Z',
    });
    const invalid = timelineItem({
      id: 'invalid',
      sortAt: '2026-04-24T99:99:99.000Z',
    });
    expect(compareEpisodeTimelineItems(valid, invalid)).toBe(-1);
    expect(compareEpisodeTimelineItems(invalid, valid)).toBe(1);
  });

  it('sorts mixed valid, invalid, and equal-instant rows transitively', () => {
    const validEarly = timelineItem({
      id: 'v-early',
      sortAt: '2026-04-24T12:00:00.000Z',
    });
    const validLate = timelineItem({
      id: 'v-late',
      sortAt: '2026-04-24T12:00:00.500Z',
    });
    const invalidHigh = timelineItem({
      id: 'bad-high',
      sortAt: 'zzz-not-a-date',
    });
    const invalidLow = timelineItem({
      id: 'bad-low',
      sortAt: 'aaa-not-a-date',
    });
    const rows = [invalidHigh, validLate, invalidLow, validEarly];
    const sorted = [...rows].sort(compareEpisodeTimelineItems);
    expect(sorted.map((r) => r.id)).toEqual([
      'v-early',
      'v-late',
      'bad-low',
      'bad-high',
    ]);
  });
});
