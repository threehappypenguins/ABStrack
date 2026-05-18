import { describe, expect, it } from 'vitest';
import type { SelectedSeries } from './InsightSeriesPicker.types.js';
import {
  assignInsightChartYAxes,
  buildInsightChartTableColumns,
  pivotChartSeriesBucketRows,
} from './insight-composed-chart-utils.js';

function series(
  overrides: Partial<SelectedSeries> &
    Pick<SelectedSeries, 'seriesId' | 'chartType'>,
): SelectedSeries {
  return {
    seriesType: 'health_marker',
    responseType: 'numeric',
    isBloodPressure: false,
    label: overrides.seriesId,
    unit: null,
    color: '#000',
    ...overrides,
  };
}

describe('assignInsightChartYAxes', () => {
  it('assigns blood pressure to the bp axis and shares numeric units on the left', () => {
    const manifest = [
      series({ seriesId: 'bac', chartType: 'line', unit: '%' }),
      series({
        seriesId: 'bp',
        chartType: 'bp_band',
        isBloodPressure: true,
        unit: 'mmHg',
      }),
    ];
    const axes = assignInsightChartYAxes(manifest);
    expect(axes.get('bac')).toBe('left');
    expect(axes.get('bp')).toBe('bp');
  });

  it('puts the second distinct unit on the right axis', () => {
    const manifest = [
      series({ seriesId: 'bac', chartType: 'line', unit: '%' }),
      series({ seriesId: 'glucose', chartType: 'line', unit: 'mmol/L' }),
    ];
    const axes = assignInsightChartYAxes(manifest);
    expect(axes.get('bac')).toBe('left');
    expect(axes.get('glucose')).toBe('right');
  });

  it('returns null for event series', () => {
    const manifest = [
      series({
        seriesId: 'symptom::nausea::boolean',
        chartType: 'event',
        seriesType: 'symptom',
        responseType: 'boolean',
      }),
    ];
    expect(
      assignInsightChartYAxes(manifest).get('symptom::nausea::boolean'),
    ).toBe(null);
  });
});

describe('pivotChartSeriesBucketRows', () => {
  it('merges long-format RPC rows into one row per bucket', () => {
    const pivoted = pivotChartSeriesBucketRows([
      {
        series_id: 'bac',
        bucket_start: '2026-01-01T00:00:00.000Z',
        value_avg: 0.05,
        systolic_avg: null,
        diastolic_avg: null,
        event_count: null,
      },
      {
        series_id: 'glucose',
        bucket_start: '2026-01-01T00:00:00.000Z',
        value_avg: 6.1,
        systolic_avg: null,
        diastolic_avg: null,
        event_count: null,
      },
    ]);

    expect(pivoted).toHaveLength(1);
    expect(pivoted[0]?.series.bac?.value_avg).toBe(0.05);
    expect(pivoted[0]?.series.glucose?.value_avg).toBe(6.1);
  });
});

describe('buildInsightChartTableColumns', () => {
  it('creates separate systolic and diastolic headers for blood pressure', () => {
    const columns = buildInsightChartTableColumns([
      series({
        seriesId: 'bp',
        chartType: 'bp_band',
        isBloodPressure: true,
        label: 'Blood pressure',
      }),
    ]);
    expect(columns.map((column) => column.label)).toEqual([
      'Blood pressure (systolic)',
      'Blood pressure (diastolic)',
    ]);
  });
});
