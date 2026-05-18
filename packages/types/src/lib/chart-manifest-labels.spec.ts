import { describe, expect, it } from 'vitest';
import {
  chartManifestHealthMarkerDisplayLabel,
  chartManifestSeriesDisplayLabel,
} from './chart-manifest-labels.js';

describe('chartManifestHealthMarkerDisplayLabel', () => {
  it('maps preset marker_kind keys to PRESET_HEALTH_MARKER_KIND_LABELS', () => {
    expect(
      chartManifestHealthMarkerDisplayLabel('health_marker::bac', 'bac'),
    ).toBe('BAC');
    expect(
      chartManifestHealthMarkerDisplayLabel(
        'health_marker::blood_glucose',
        'blood_glucose',
      ),
    ).toBe('Glucose');
  });

  it('maps when rpcLabel is the raw marker_kind even if series_id is unexpected', () => {
    expect(chartManifestHealthMarkerDisplayLabel('bac', 'bac')).toBe('BAC');
  });

  it('keeps custom and unknown RPC labels', () => {
    expect(
      chartManifestHealthMarkerDisplayLabel(
        'health_marker::custom::steps',
        'Steps',
      ),
    ).toBe('Steps');
    expect(
      chartManifestHealthMarkerDisplayLabel(
        'health_marker::wellness_mood',
        'wellness_mood',
      ),
    ).toBe('wellness_mood');
  });
});

describe('chartManifestSeriesDisplayLabel', () => {
  it('passes symptom labels through unchanged', () => {
    expect(
      chartManifestSeriesDisplayLabel(
        'symptom',
        'symptom::fatigue::boolean',
        'Fatigue',
      ),
    ).toBe('Fatigue');
  });
});
