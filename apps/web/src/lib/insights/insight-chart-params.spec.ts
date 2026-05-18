import {
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

  it('builds inclusive local-day RPC bounds', () => {
    const range = getDefaultInsightDateRange();
    const { p_from, p_to } = insightDateRangeToRpcBounds(range);

    expect(new Date(p_from).getHours()).toBe(0);
    expect(new Date(p_to).getHours()).toBe(23);
    expect(new Date(p_from).getTime()).toBeLessThanOrEqual(
      new Date(p_to).getTime(),
    );
  });

  it('formats a plain-English chart summary', () => {
    const range = {
      from: new Date(2026, 3, 1),
      to: new Date(2026, 3, 30),
    };
    expect(
      formatInsightChartPageSummary(['BAC readings'], range, 'day'),
    ).toMatch(/BAC readings from April 1 to April 30, daily buckets/);
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
