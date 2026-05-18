import { describe, expect, it } from 'vitest';
import type { SelectedSeries } from './InsightSeriesPicker.types.js';
import {
  assignInsightChartYAxes,
  buildInsightChartTableColumns,
  chartSeriesBpBandKey,
  chartSeriesDiastolicAvgKey,
  chartSeriesSystolicAvgKey,
  chartSeriesValueAvgKey,
  enrichInsightChartDataForBloodPressure,
  flattenChartSeriesRows,
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

describe('chart series data keys', () => {
  it('uses encoded flat keys so Recharts does not treat series IDs as object paths', () => {
    const seriesId = 'health_marker::custom::hdl.ldl';
    const key = chartSeriesValueAvgKey(seriesId);
    const flat = flattenChartSeriesRows([
      {
        bucketStart: '2026-01-01T00:00:00.000Z',
        series: {
          [seriesId]: {
            value_avg: 1.2,
            systolic_avg: null,
            diastolic_avg: null,
            event_count: null,
          },
        },
      },
    ])[0];

    expect(key).not.toContain('.');
    expect(key.startsWith('ics_')).toBe(true);
    expect(flat[key]).toBe(1.2);
    expect(flat[`${seriesId}__value_avg`]).toBeUndefined();
  });
});

describe('enrichInsightChartDataForBloodPressure', () => {
  it('adds [diastolic, systolic] range tuples for bp_band series', () => {
    const seriesId = 'health_marker::blood_pressure';
    const chartData = enrichInsightChartDataForBloodPressure(
      flattenChartSeriesRows([
        {
          bucketStart: '2026-01-01T00:00:00.000Z',
          series: {
            [seriesId]: {
              value_avg: null,
              systolic_avg: 130,
              diastolic_avg: 85,
              event_count: null,
            },
          },
        },
      ]),
      [
        series({
          seriesId,
          chartType: 'bp_band',
          isBloodPressure: true,
        }),
      ],
    );

    expect(chartData[0]?.[chartSeriesBpBandKey(seriesId)]).toEqual([85, 130]);
    expect(chartData[0]?.[chartSeriesSystolicAvgKey(seriesId)]).toBe(130);
    expect(chartData[0]?.[chartSeriesDiastolicAvgKey(seriesId)]).toBe(85);
  });
});

describe('formatInsightChartBucketLabel', () => {
  it('formats patient-local bucket_start in the same timezone as get_chart_series', () => {
    const patientLocalMidnight = '2026-01-01T05:00:00.000Z';
    const label = formatInsightChartBucketLabel(
      patientLocalMidnight,
      'day',
      'America/New_York',
    );

    expect(label).toContain('Jan');
    expect(label).toContain('1');
    expect(label).not.toMatch(/Dec/i);
  });

  it('includes the year for week buckets', () => {
    const label = formatInsightChartBucketLabel(
      '2026-01-01T00:00:00.000Z',
      'week',
      'UTC',
    );
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
