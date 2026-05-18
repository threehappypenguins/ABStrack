/**
 * `response_type` values returned by `get_user_chart_manifest`.
 * Matches {@link UserChartManifestSeries} in `@abstrack/supabase`.
 */
export type ChartManifestResponseType =
  | 'numeric'
  | 'boolean'
  | 'severity'
  | 'text';

/** Manifest row shape from `get_user_chart_manifest` (snake_case RPC fields). */
export interface ChartManifestRow {
  series_id: string;
  series_type: 'health_marker' | 'symptom';
  label: string;
  response_type: ChartManifestResponseType;
  is_blood_pressure: boolean;
  unit: string | null;
  observation_count: number;
  first_observed_at: string;
  last_observed_at: string;
}

/** Response types the chart builder can render (excludes e.g. `text`). */
export type ChartableResponseType = Exclude<ChartManifestResponseType, 'text'>;

/**
 * Manifest row eligible for the series picker (at least one chart type applies).
 * Narrow with {@link isChartableManifestRow}.
 */
export type ChartableManifestRow = ChartManifestRow & {
  response_type: ChartableResponseType;
};

/** Chart rendering mode for one selected series. */
export type ChartTypeChoice = 'line' | 'bar' | 'scatter' | 'event' | 'bp_band';

/** One series chosen in the chart builder with display metadata. */
export interface SelectedSeries {
  seriesId: string;
  seriesType: 'health_marker' | 'symptom';
  responseType: ChartableResponseType;
  isBloodPressure: boolean;
  label: string;
  unit: string | null;
  chartType: ChartTypeChoice;
  /** Assigned automatically from {@link INSIGHT_SERIES_SLOT_COLORS}; not user-configurable. */
  color: string;
}

/** Props for {@link InsightSeriesPicker}. */
export interface InsightSeriesPickerProps {
  /** Full RPC manifest; non-chartable rows (e.g. `text`) are omitted from the picker. */
  manifest: ChartManifestRow[];
  value: SelectedSeries[];
  onChange: (series: SelectedSeries[]) => void;
}
