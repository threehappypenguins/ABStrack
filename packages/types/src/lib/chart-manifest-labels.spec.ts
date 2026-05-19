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

  it('keeps custom marker labels when the custom name matches a preset key', () => {
    expect(
      chartManifestHealthMarkerDisplayLabel(
        'health_marker::custom::bac',
        'bac',
      ),
    ).toBe('bac');
  });

  it('does not map preset labels from rpcLabel alone when series_id is not a preset key', () => {
    expect(chartManifestHealthMarkerDisplayLabel('bac', 'bac')).toBe('bac');
  });

  it('does not treat inherited property names as preset keys', () => {
    expect(
      chartManifestHealthMarkerDisplayLabel(
        'health_marker::toString',
        'toString',
      ),
    ).toBe('toString');
    expect(
      chartManifestHealthMarkerDisplayLabel(
        'health_marker::constructor',
        'constructor',
      ),
    ).toBe('constructor');
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
