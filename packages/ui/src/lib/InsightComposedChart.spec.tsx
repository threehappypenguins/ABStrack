import { render, screen, within } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartSeriesRow } from './InsightComposedChart.types.js';
import type { SelectedSeries } from './InsightSeriesPicker.types.js';
import {
  chartSeriesBpBandKey,
  chartSeriesDiastolicAvgKey,
  chartSeriesSystolicAvgKey,
  chartSeriesValueAvgKey,
} from './insight-composed-chart-utils.js';

const rechartsMocks = vi.hoisted(() => ({
  Line: [] as Record<string, unknown>[],
  Bar: [] as Record<string, unknown>[],
  Scatter: [] as Record<string, unknown>[],
  Area: [] as Record<string, unknown>[],
  ReferenceLine: [] as Record<string, unknown>[],
}));

function captureMock(name: keyof typeof rechartsMocks) {
  return function MockComponent(props: Record<string, unknown>) {
    rechartsMocks[name].push(props);
    return <div data-testid={`mock-${name}`} />;
  };
}

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  ComposedChart: ({ children }: { children: ReactNode }) => (
    <div data-testid="composed-chart">{children}</div>
  ),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Line: captureMock('Line'),
  Bar: captureMock('Bar'),
  Scatter: captureMock('Scatter'),
  Area: captureMock('Area'),
  ReferenceLine: captureMock('ReferenceLine'),
}));

import { InsightComposedChart } from './InsightComposedChart.js';

function baseSeries(
  overrides: Partial<SelectedSeries> &
    Pick<SelectedSeries, 'seriesId' | 'chartType'>,
): SelectedSeries {
  return {
    seriesType: 'health_marker',
    responseType: 'numeric',
    isBloodPressure: false,
    label: overrides.label ?? overrides.seriesId,
    unit: overrides.unit ?? null,
    color: overrides.color ?? '#1d4ed8',
    ...overrides,
  };
}

function bucketRow(
  bucketStart: string,
  seriesId: string,
  metrics: ChartSeriesRow['series'][string],
): ChartSeriesRow {
  return {
    bucketStart,
    series: { [seriesId]: metrics },
  };
}

function mergeRows(...rows: ChartSeriesRow[]): ChartSeriesRow[] {
  const merged = new Map<string, ChartSeriesRow>();
  for (const row of rows) {
    const existing = merged.get(row.bucketStart);
    if (existing) {
      existing.series = { ...existing.series, ...row.series };
    } else {
      merged.set(row.bucketStart, {
        bucketStart: row.bucketStart,
        series: { ...row.series },
      });
    }
  }
  return [...merged.values()].sort((a, b) =>
    a.bucketStart.localeCompare(b.bucketStart),
  );
}

describe('InsightComposedChart', () => {
  beforeEach(() => {
    for (const key of Object.keys(
      rechartsMocks,
    ) as (keyof typeof rechartsMocks)[]) {
      rechartsMocks[key] = [];
    }
  });

  it('renders exactly two Line components for bp_band and never a single Line alone', () => {
    const seriesId = 'health_marker::blood_pressure';
    const selected = baseSeries({
      seriesId,
      chartType: 'bp_band',
      isBloodPressure: true,
      label: 'Blood pressure',
      unit: 'mmHg',
    });
    const data = mergeRows(
      bucketRow('2026-01-01T00:00:00.000Z', seriesId, {
        value_avg: null,
        systolic_avg: 130,
        diastolic_avg: 85,
        event_count: null,
      }),
      bucketRow('2026-02-01T00:00:00.000Z', seriesId, {
        value_avg: null,
        systolic_avg: 128,
        diastolic_avg: 82,
        event_count: null,
      }),
    );

    render(
      <InsightComposedChart
        series={[selected]}
        data={data}
        bucket="month"
        loading={false}
        summary="Blood pressure trend."
        patientTimeZone="UTC"
      />,
    );

    const lines = rechartsMocks.Line.filter(
      (props) =>
        props.dataKey === chartSeriesSystolicAvgKey(seriesId) ||
        props.dataKey === chartSeriesDiastolicAvgKey(seriesId),
    );
    expect(lines).toHaveLength(2);
    expect(
      lines.some(
        (props) => props.dataKey === chartSeriesSystolicAvgKey(seriesId),
      ),
    ).toBe(true);
    expect(
      lines.some(
        (props) => props.dataKey === chartSeriesDiastolicAvgKey(seriesId),
      ),
    ).toBe(true);
    expect(rechartsMocks.Area).toHaveLength(1);
    expect(rechartsMocks.Area[0]?.dataKey).toBe(chartSeriesBpBandKey(seriesId));
    expect(rechartsMocks.Area[0]?.baseLine).toBeUndefined();
  });

  it('renders ReferenceLine only for buckets where event_count is greater than zero', () => {
    const seriesId = 'symptom::nausea::boolean';
    const selected = baseSeries({
      seriesId,
      chartType: 'event',
      seriesType: 'symptom',
      responseType: 'boolean',
      label: 'Nausea',
    });
    const data = mergeRows(
      bucketRow('2026-01-01T00:00:00.000Z', seriesId, {
        value_avg: null,
        systolic_avg: null,
        diastolic_avg: null,
        event_count: 0,
      }),
      bucketRow('2026-02-01T00:00:00.000Z', seriesId, {
        value_avg: null,
        systolic_avg: null,
        diastolic_avg: null,
        event_count: 2,
      }),
      bucketRow('2026-03-01T00:00:00.000Z', seriesId, {
        value_avg: null,
        systolic_avg: null,
        diastolic_avg: null,
        event_count: null,
      }),
    );

    render(
      <InsightComposedChart
        series={[selected]}
        data={data}
        bucket="month"
        loading={false}
        summary="Nausea events."
        patientTimeZone="UTC"
      />,
    );

    expect(rechartsMocks.ReferenceLine).toHaveLength(1);
    expect(rechartsMocks.ReferenceLine[0]?.x).toBe('2026-02-01T00:00:00.000Z');
  });

  it('includes separate systolic and diastolic columns for blood pressure in the accessible table', () => {
    const seriesId = 'health_marker::blood_pressure';
    const selected = baseSeries({
      seriesId,
      chartType: 'bp_band',
      isBloodPressure: true,
      label: 'Blood pressure',
      unit: 'mmHg',
    });

    render(
      <InsightComposedChart
        series={[selected]}
        data={[
          bucketRow('2026-01-01T00:00:00.000Z', seriesId, {
            value_avg: null,
            systolic_avg: 120,
            diastolic_avg: 80,
            event_count: null,
          }),
        ]}
        bucket="day"
        loading={false}
        summary="Blood pressure table."
        patientTimeZone="UTC"
      />,
    );

    const table = screen.getByRole('table', { hidden: true });
    const headers = within(table).getAllByRole('columnheader', {
      hidden: true,
    });
    expect(headers.map((cell) => cell.textContent)).toEqual(
      expect.arrayContaining([
        'Blood pressure (systolic)',
        'Blood pressure (diastolic)',
      ]),
    );
  });

  it.each([
    ['line', 'Line'] as const,
    ['bar', 'Bar'] as const,
    ['scatter', 'Scatter'] as const,
  ])(
    'renders %s chart type with the matching Recharts component',
    (chartType, component) => {
      const seriesId = 'health_marker::bac';
      const selected = baseSeries({
        seriesId,
        chartType,
        label: 'BAC',
        unit: '%',
      });

      render(
        <InsightComposedChart
          series={[selected]}
          data={[
            bucketRow('2026-01-01T00:00:00.000Z', seriesId, {
              value_avg: 0.05,
              systolic_avg: null,
              diastolic_avg: null,
              event_count: null,
            }),
          ]}
          bucket="week"
          loading={false}
          summary={`${chartType} chart.`}
          patientTimeZone="UTC"
        />,
      );

      const valueKey = chartSeriesValueAvgKey(seriesId);
      const rendered = rechartsMocks[component].filter(
        (props) => props.dataKey === valueKey,
      );
      expect(rendered).toHaveLength(1);
    },
  );

  it('shows an alert instead of the chart when three distinct value units are selected', () => {
    render(
      <InsightComposedChart
        series={[
          baseSeries({ seriesId: 'bac', chartType: 'line', unit: '%' }),
          baseSeries({
            seriesId: 'glucose',
            chartType: 'line',
            unit: 'mmol/L',
          }),
          baseSeries({ seriesId: 'hr', chartType: 'line', unit: 'bpm' }),
        ]}
        data={[]}
        bucket="day"
        loading={false}
        summary="Unsupported combination."
        patientTimeZone="UTC"
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      /at most 2 different measurement units/i,
    );
    expect(screen.queryByTestId('composed-chart')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/no data for this range/i),
    ).not.toBeInTheDocument();
  });

  it('shows a patient timezone note when showPatientTimeZoneNote is true', () => {
    render(
      <InsightComposedChart
        series={[baseSeries({ seriesId: 'bac', chartType: 'line', unit: '%' })]}
        data={[]}
        bucket="day"
        loading={false}
        summary="BAC trend."
        patientTimeZone="America/Chicago"
        showPatientTimeZoneNote
      />,
    );

    expect(screen.getByText(/patient's local timezone/i)).toBeInTheDocument();
  });
});
