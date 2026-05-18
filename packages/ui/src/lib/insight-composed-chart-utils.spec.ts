import { describe, expect, it } from 'vitest';
import type { SelectedSeries } from './InsightSeriesPicker.types.js';
import {
  assignInsightChartYAxes,
  buildInsightChartTableColumns,
  formatInsightChartBucketLabel,
  formatInsightChartPatientTimeZoneNote,
  getInsightChartUnsupportedMessage,
  isInsightChartSeriesSupported,
  pivotChartSeriesBucketRows,
  wouldExceedDistinctNonBpValueUnitLimit,
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

  it('assigns null to a third distinct non-BP value unit instead of sharing the right axis', () => {
    const manifest = [
      series({ seriesId: 'bac', chartType: 'line', unit: '%' }),
      series({ seriesId: 'glucose', chartType: 'line', unit: 'mmol/L' }),
      series({ seriesId: 'hr', chartType: 'line', unit: 'bpm' }),
    ];
    const axes = assignInsightChartYAxes(manifest);
    expect(axes.get('bac')).toBe('left');
    expect(axes.get('glucose')).toBe('right');
    expect(axes.get('hr')).toBe(null);
    expect(isInsightChartSeriesSupported(manifest)).toBe(false);
    expect(getInsightChartUnsupportedMessage(manifest)).toBeTruthy();
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

describe('wouldExceedDistinctNonBpValueUnitLimit', () => {
  it('allows a third series when it reuses an existing unit', () => {
    const current = [
      series({ seriesId: 'bac', chartType: 'line', unit: '%' }),
      series({ seriesId: 'glucose', chartType: 'line', unit: 'mmol/L' }),
    ];
    const next = series({ seriesId: 'bac-2', chartType: 'bar', unit: '%' });
    expect(wouldExceedDistinctNonBpValueUnitLimit(current, next)).toBe(false);
  });

  it('blocks a third distinct unit', () => {
    const current = [
      series({ seriesId: 'bac', chartType: 'line', unit: '%' }),
      series({ seriesId: 'glucose', chartType: 'line', unit: 'mmol/L' }),
    ];
    const next = series({ seriesId: 'hr', chartType: 'line', unit: 'bpm' });
    expect(wouldExceedDistinctNonBpValueUnitLimit(current, next)).toBe(true);
  });
});

describe('formatInsightChartBucketLabel', () => {
  const midnightUtc = '2026-01-01T00:00:00.000Z';

  it('formats using the patient timezone instead of the viewer device zone', () => {
    const inUtc = formatInsightChartBucketLabel(midnightUtc, 'day', 'UTC');
    const inNewYork = formatInsightChartBucketLabel(
      midnightUtc,
      'day',
      'America/New_York',
    );

    expect(inUtc).toContain('Jan');
    expect(inUtc).toContain('1');
    expect(inNewYork).toContain('Dec');
    expect(inNewYork).toContain('31');
  });

  it('includes the year for week buckets', () => {
    const label = formatInsightChartBucketLabel(midnightUtc, 'week', 'UTC');
    expect(label).toContain('2026');
  });
});

describe('formatInsightChartPatientTimeZoneNote', () => {
  it('mentions the patient local timezone', () => {
    expect(formatInsightChartPatientTimeZoneNote('America/New_York')).toMatch(
      /patient's local timezone/i,
    );
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
