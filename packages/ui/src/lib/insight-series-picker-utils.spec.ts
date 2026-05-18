import {
  canAddAnotherSeries,
  computeVisibleSlotCount,
  createSelectedSeriesFromManifestRow,
  defaultChartTypeForManifestRow,
  filterChartableManifestRows,
  getChartTypeChoicesForManifestRow,
  isChartableManifestRow,
  isChartTypeSelectorHidden,
} from './insight-series-picker-utils.js';
import type {
  ChartableManifestRow,
  ChartManifestResponseType,
  ChartManifestRow,
  SelectedSeries,
} from './InsightSeriesPicker.types.js';

const numericRow: ChartableManifestRow = {
  series_id: 'n-1',
  series_type: 'health_marker',
  label: 'Weight',
  response_type: 'numeric',
  is_blood_pressure: false,
  unit: null,
  observation_count: 1,
  first_observed_at: '2026-01-01',
  last_observed_at: '2026-01-02',
};

const textRow: ChartManifestRow = {
  ...numericRow,
  series_id: 'notes-1',
  label: 'Free-text notes',
  response_type: 'text',
};

const bpRow: ChartableManifestRow = {
  ...numericRow,
  series_id: 'bp-1',
  label: 'Blood pressure',
  is_blood_pressure: true,
};

/** Test helper: chartable fixtures must produce a selected series. */
function selectedFromRow(
  row: ChartableManifestRow,
  slotIndex = 0,
): SelectedSeries {
  const series = createSelectedSeriesFromManifestRow(row, slotIndex);
  if (!series) {
    throw new Error(
      `Expected chartable fixture ${row.series_id} to map to a series`,
    );
  }
  return series;
}

describe('insight-series-picker-utils', () => {
  it('identifies chartable manifest rows and filters out text', () => {
    expect(isChartableManifestRow(numericRow)).toBe(true);
    expect(isChartableManifestRow(textRow)).toBe(false);
    expect(filterChartableManifestRows([numericRow, textRow])).toEqual([
      numericRow,
    ]);
  });

  it('treats unknown response_type values as non-chartable without throwing', () => {
    const futureRow: ChartManifestRow = {
      ...numericRow,
      series_id: 'future-1',
      response_type: 'likert' as ChartManifestResponseType,
    };

    expect(getChartTypeChoicesForManifestRow(futureRow)).toEqual([]);
    expect(isChartableManifestRow(futureRow)).toBe(false);
    expect(defaultChartTypeForManifestRow(futureRow)).toBeUndefined();
    expect(
      filterChartableManifestRows([numericRow, futureRow, textRow]),
    ).toEqual([numericRow]);
  });

  it('returns undefined from createSelectedSeriesFromManifestRow when chart type cannot be resolved', () => {
    expect(
      createSelectedSeriesFromManifestRow(numericRow, 0, 'bp_band'),
    ).toBeUndefined();
  });

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

  it('caps visible slots when value is cleared but revealed count stayed high', () => {
    expect(computeVisibleSlotCount([], 2)).toBe(1);
    expect(computeVisibleSlotCount([], 3)).toBe(1);
  });

  it('reports when another series can be added', () => {
    expect(canAddAnotherSeries([], 1)).toBe(false);
    expect(canAddAnotherSeries([selectedFromRow(numericRow)], 1)).toBe(true);
    expect(canAddAnotherSeries([], 3)).toBe(false);
  });
});
