/**
 * Jest stub for `@abstrack/ui/insights-web` (see practitioner `jest.config.cts` `moduleNameMapper`).
 * Patient-detail specs only need lightweight, deterministic chart controls (e.g. “Select first series”)
 * and avoid loading the full insights chart module graph (Recharts, composed chart layout, dist resolution).
 *
 * Real chart utils/types load via `@abstrack/ui/insights-web-impl` (unmapped) so `requireActual` does not
 * resolve back to this file.
 */
import type {
  ChartManifestRow,
  ChartTypeChoice,
  InsightSeriesPickerProps,
  SelectedSeries,
} from '@abstrack/ui/insights-web-impl';
import type {
  ChartSeriesBucketMetrics,
  ChartSeriesRow,
  InsightChartBucket,
  InsightComposedChartProps,
} from '@abstrack/ui/insights-web-impl';
import type {
  InsightDateRange,
  InsightDateRangePickerProps,
  InsightDateRangePresetId,
} from '@abstrack/ui/insights-web-impl';

const {
  filterChartableManifestRows,
  pivotChartSeriesBucketRows,
  reconcileSelectedSeriesWithManifest,
} = jest.requireActual(
  '@abstrack/ui/insights-web-impl',
) as typeof import('@abstrack/ui/insights-web-impl');

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
}: {
  manifest: ChartManifestRow[];
  value: SelectedSeries[];
  onChange: (next: SelectedSeries[]) => void;
}) {
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
