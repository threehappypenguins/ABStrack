import type { EpisodeRow } from '@abstrack/types';

import {
  episodeRowEligibleForHealthMarkerResume,
  episodeRowToActiveHomeSummary,
} from './EpisodeStartHomeCta';

function baseRow(over: Partial<EpisodeRow>): EpisodeRow {
  return {
    id: 'ep-1',
    user_id: 'u-1',
    symptom_preset_id: 'sym-1',
    health_marker_preset_id: 'hm-1',
    episode_type: 'Other',
    episode_label: null,
    additional_notes: null,
    note: null,
    started_at: '2026-01-01T00:00:00Z',
    ended_at: null,
    post_marker_step_completed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('episodeRowEligibleForHealthMarkerResume', () => {
  it('is true only when post-marker step is done and a health marker preset id exists', () => {
    expect(
      episodeRowEligibleForHealthMarkerResume({
        post_marker_step_completed_at: '2026-01-02T00:00:00Z',
        health_marker_preset_id: 'hm-1',
      }),
    ).toBe(true);
    expect(
      episodeRowEligibleForHealthMarkerResume({
        post_marker_step_completed_at: '2026-01-02T00:00:00Z',
        health_marker_preset_id: null,
      }),
    ).toBe(false);
    expect(
      episodeRowEligibleForHealthMarkerResume({
        post_marker_step_completed_at: null,
        health_marker_preset_id: 'hm-1',
      }),
    ).toBe(false);
  });
});

describe('episodeRowToActiveHomeSummary', () => {
  it('returns null when post-marker is done but health marker preset is missing', () => {
    expect(
      episodeRowToActiveHomeSummary(
        baseRow({
          post_marker_step_completed_at: '2026-01-02T00:00:00Z',
          health_marker_preset_id: null,
          symptom_preset_id: null,
        }),
      ),
    ).toBeNull();
  });

  it('returns health-marker resume when post-marker is done and preset id is present', () => {
    expect(
      episodeRowToActiveHomeSummary(
        baseRow({
          post_marker_step_completed_at: '2026-01-02T00:00:00Z',
          health_marker_preset_id: 'hm-9',
        }),
      ),
    ).toEqual({
      episodeId: 'ep-1',
      resumeAtHealthMarkers: true,
      symptomPresetId: 'sym-1',
    });
  });

  it('returns symptom resume when only symptom path applies', () => {
    expect(
      episodeRowToActiveHomeSummary(
        baseRow({
          symptom_preset_id: 'sym-2',
          post_marker_step_completed_at: null,
        }),
      ),
    ).toEqual({
      episodeId: 'ep-1',
      resumeAtHealthMarkers: false,
      symptomPresetId: 'sym-2',
    });
  });
});
