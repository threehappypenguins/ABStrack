/**
 * Jest stub for `@abstrack/ui/insights-web` (see practitioner `jest.config.cts` `moduleNameMapper`).
 * Patient-detail specs only need lightweight, deterministic chart controls (e.g. “Select first series”)
 * and avoid loading the full insights chart module graph (Recharts, composed chart layout, dist resolution).
 *
 * Pure helpers/types load via `@abstrack/ui/insights-web-utils` (no chart components at module evaluation).
 */
import type {
  ChartManifestRow,
  ChartTypeChoice,
  ChartSeriesBucketMetrics,
  ChartSeriesRow,
  InsightChartBucket,
  InsightComposedChartProps,
  InsightDateRange,
  InsightDateRangePickerProps,
  InsightDateRangePresetId,
  InsightSeriesPickerProps,
  SelectedSeries,
} from '@abstrack/ui/insights-web-utils';

const {
  filterChartableManifestRows,
  pivotChartSeriesBucketRows,
  reconcileSelectedSeriesWithManifest,
} = jest.requireActual(
  '@abstrack/ui/insights-web-utils',
) as typeof import('@abstrack/ui/insights-web-utils');

export {
  filterChartableManifestRows,
  pivotChartSeriesBucketRows,
  reconcileSelectedSeriesWithManifest,
};

export type {
  ChartManifestRow,
  ChartSeriesBucketMetrics,
  ChartSeriesRow,
  ChartTypeChoice,
  InsightChartBucket,
  InsightComposedChartProps,
  InsightDateRange,
  InsightDateRangePickerProps,
  InsightDateRangePresetId,
  InsightSeriesPickerProps,
  SelectedSeries,
};

export function InsightSeriesPicker({
  manifest,
  value,
  onChange,
}: InsightSeriesPickerProps) {
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          const row = manifest[0];
          if (!row) {
            return;
          }
          onChange([
            {
              seriesId: row.series_id,
              seriesType: row.series_type,
              responseType: row.response_type as 'numeric',
              isBloodPressure: row.is_blood_pressure,
              label: row.label,
              unit: row.unit,
              chartType: 'line',
              color: '#1d4ed8',
            },
          ]);
        }}
      >
        Select first series
      </button>
      <span data-testid="selected-count">{value.length}</span>
    </div>
  );
}

export function InsightDateRangePicker({
  value,
  onChange,
}: {
  value: InsightDateRange;
  onChange: (next: InsightDateRange) => void;
}) {
  return (
    <div data-testid="date-range-picker">
      <button
        type="button"
        onClick={() =>
          onChange({
            from: new Date(2026, 0, 1),
            to: new Date(2026, 0, 31),
          })
        }
      >
        Set January 2026 range
      </button>
      <span data-testid="range-from">{value.from.toISOString()}</span>
    </div>
  );
}

export function InsightComposedChart() {
  return <div data-testid="composed-chart" />;
}

export function InsightsSummarySection({
  summary,
  loading,
  error,
}: {
  summary: { total_episode_count: number } | null;
  loading?: boolean;
  error?: string | null;
}) {
  return (
    <div data-testid="insights-summary-section">
      {loading ? <p role="status">Overview loading</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <p>{summary?.total_episode_count ?? 0} overview episodes</p>
    </div>
  );
}
