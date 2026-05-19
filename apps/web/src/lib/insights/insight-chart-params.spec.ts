import {
  chartSnapshotBoundsToInsightDateRange,
  chartSnapshotDefinitionToSelectedSeries,
  formatInsightChartPageSummary,
  getDefaultInsightDateRange,
  insightDateRangeToRpcBounds,
  selectedSeriesToChartSeriesSelection,
} from './insight-chart-params';

describe('insight-chart-params', () => {
  it('defaults to a 30-day inclusive local range ending today', () => {
    const range = getDefaultInsightDateRange();
    const dayMs = 86_400_000;
    const spanDays =
      Math.round((range.to.getTime() - range.from.getTime()) / dayMs) + 1;
    expect(spanDays).toBe(30);
    expect(range.to.getHours()).toBe(0);
    expect(range.from.getHours()).toBe(0);
  });

  it('builds local-day RPC bounds with an exclusive next-day p_to', () => {
    const range = {
      from: new Date(2026, 3, 1),
      to: new Date(2026, 3, 30),
    };
    const { p_from, p_to } = insightDateRangeToRpcBounds(range);

    expect(new Date(p_from)).toEqual(new Date(2026, 3, 1, 0, 0, 0, 0));
    expect(new Date(p_to)).toEqual(new Date(2026, 4, 1, 0, 0, 0, 0));
    expect(new Date(p_from).getTime()).toBeLessThan(new Date(p_to).getTime());
  });

  it('formats a chart summary with locale-aware date labels', () => {
    const range = {
      from: new Date(2026, 3, 1),
      to: new Date(2026, 3, 30),
    };
    const dateFormatter = new Intl.DateTimeFormat(undefined, {
      month: 'long',
      day: 'numeric',
    });
    const fromLabel = dateFormatter.format(range.from);
    const toLabel = dateFormatter.format(range.to);

    expect(formatInsightChartPageSummary(['BAC readings'], range, 'day')).toBe(
      `BAC readings from ${fromLabel} to ${toLabel}, grouped by day`,
    );
  });

  it('round-trips snapshot RPC bounds to an inclusive date range', () => {
    const range = {
      from: new Date(2026, 3, 1),
      to: new Date(2026, 3, 30),
    };
    const { p_from, p_to } = insightDateRangeToRpcBounds(range);
    const restored = chartSnapshotBoundsToInsightDateRange(p_from, p_to);

    expect(restored.from).toEqual(range.from);
    expect(restored.to).toEqual(range.to);
  });

  it('normalizes snapshot bounds to local calendar midnights for the date picker', () => {
    const fromIso = new Date(2026, 3, 15, 14, 30, 0).toISOString();
    const toIso = new Date(2026, 4, 1, 9, 45, 0).toISOString();

    const restored = chartSnapshotBoundsToInsightDateRange(fromIso, toIso);

    expect(restored.from).toEqual(new Date(2026, 3, 15, 0, 0, 0, 0));
    expect(restored.to).toEqual(new Date(2026, 3, 30, 0, 0, 0, 0));
  });

  it('maps snapshot series definition to selected series', () => {
    expect(
      chartSnapshotDefinitionToSelectedSeries([
        {
          seriesId: 'health_marker::bac',
          seriesType: 'health_marker',
          responseType: 'numeric',
          isBloodPressure: false,
          label: 'BAC',
          unit: '%',
          chartType: 'line',
          color: '#1d4ed8',
        },
      ]),
    ).toEqual([
      {
        seriesId: 'health_marker::bac',
        seriesType: 'health_marker',
        responseType: 'numeric',
        isBloodPressure: false,
        label: 'BAC',
        unit: '%',
        chartType: 'line',
        color: '#1d4ed8',
      },
    ]);
  });

  it('maps selected series to RPC selections', () => {
    expect(
      selectedSeriesToChartSeriesSelection([
        {
          seriesId: 'health_marker::bac',
          seriesType: 'health_marker',
          responseType: 'numeric',
          isBloodPressure: false,
          label: 'BAC',
          unit: '%',
          chartType: 'line',
          color: '#1d4ed8',
        },
      ]),
    ).toEqual([
      {
        series_id: 'health_marker::bac',
        series_type: 'health_marker',
        response_type: 'numeric',
        is_blood_pressure: false,
      },
    ]);
  });
});
