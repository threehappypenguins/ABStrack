/**
 * Jest stub for `@abstrack/ui/insights-web` (see practitioner `jest.config.cts` `moduleNameMapper`).
 * Avoids loading `packages/ui/dist` chart components that import `react-native` via `useFocusRing`.
 */
import type {
  ChartManifestRow,
  SelectedSeries,
} from '../../../../packages/ui/src/lib/InsightSeriesPicker.types.js';
import type { InsightDateRange } from '../../../../packages/ui/src/lib/InsightDateRangePicker.js';

const uiLib = '../../../../packages/ui/src/lib';

const { pivotChartSeriesBucketRows } = jest.requireActual(
  `${uiLib}/insight-composed-chart-utils`,
) as typeof import('../../../../packages/ui/src/lib/insight-composed-chart-utils.js');

const { filterChartableManifestRows, reconcileSelectedSeriesWithManifest } =
  jest.requireActual(`${uiLib}/insight-series-picker-utils`) as typeof import('../../../../packages/ui/src/lib/insight-series-picker-utils.js');

export {
  pivotChartSeriesBucketRows,
  filterChartableManifestRows,
  reconcileSelectedSeriesWithManifest,
};

export type { ChartTypeChoice, SelectedSeries } from '../../../../packages/ui/src/lib/InsightSeriesPicker.types.js';
export type {
  InsightDateRange,
  InsightDateRangePickerProps,
  InsightDateRangePresetId,
} from '../../../../packages/ui/src/lib/InsightDateRangePicker.js';
export type {
  ChartSeriesBucketMetrics,
  ChartSeriesRow,
  InsightChartBucket,
  InsightComposedChartProps,
} from '../../../../packages/ui/src/lib/InsightComposedChart.types.js';
export type { ChartManifestRow } from '../../../../packages/ui/src/lib/InsightSeriesPicker.types.js';
export type { InsightSeriesPickerProps } from '../../../../packages/ui/src/lib/InsightSeriesPicker.types.js';

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
