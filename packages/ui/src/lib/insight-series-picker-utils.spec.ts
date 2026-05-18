import {
  canAddAnotherSeries,
  computeVisibleSlotCount,
  createSelectedSeriesFromManifestRow,
  getChartTypeChoicesForManifestRow,
  isChartTypeSelectorHidden,
} from './insight-series-picker-utils.js';
import type {
  ChartManifestRow,
  SelectedSeries,
} from './InsightSeriesPicker.types.js';

const numericRow: ChartManifestRow = {
  series_id: 'n-1',
  series_type: 'health_marker',
  label: 'Weight',
  response_type: 'numeric',
  is_blood_pressure: false,
  observation_count: 1,
  first_observed_at: '2026-01-01',
  last_observed_at: '2026-01-02',
};

const bpRow: ChartManifestRow = {
  ...numericRow,
  series_id: 'bp-1',
  label: 'Blood pressure',
  is_blood_pressure: true,
};

describe('insight-series-picker-utils', () => {
  it('returns chart-type choices per manifest row', () => {
    expect(getChartTypeChoicesForManifestRow(bpRow)).toEqual(['bp_band']);
    expect(getChartTypeChoicesForManifestRow(numericRow)).toEqual([
      'line',
      'bar',
      'scatter',
    ]);
  });

  it('hides the chart-type selector when only one choice exists', () => {
    expect(isChartTypeSelectorHidden(bpRow)).toBe(true);
    expect(isChartTypeSelectorHidden(numericRow)).toBe(false);
  });

  it('computes visible slot counts from value and revealed slots', () => {
    expect(computeVisibleSlotCount([], 1)).toBe(1);
    expect(computeVisibleSlotCount([{} as SelectedSeries], 1)).toBe(1);
    expect(computeVisibleSlotCount([{} as SelectedSeries], 2)).toBe(2);
    expect(
      computeVisibleSlotCount([{} as SelectedSeries, {} as SelectedSeries], 1),
    ).toBe(2);
  });

  it('reports when another series can be added', () => {
    expect(canAddAnotherSeries([], 1)).toBe(false);
    expect(
      canAddAnotherSeries(
        [createSelectedSeriesFromManifestRow(numericRow, 0)],
        1,
      ),
    ).toBe(true);
    expect(canAddAnotherSeries([], 3)).toBe(false);
  });
});
