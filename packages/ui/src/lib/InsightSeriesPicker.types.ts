/** Chartable series metadata row from `get_user_chart_manifest`. */
export interface ChartManifestRow {
  series_id: string;
  series_type: 'health_marker' | 'symptom';
  label: string;
  response_type: 'numeric' | 'boolean' | 'severity';
  is_blood_pressure: boolean;
  unit?: string;
  observation_count: number;
  first_observed_at: string;
  last_observed_at: string;
}

/** Chart rendering mode for one selected series. */
export type ChartTypeChoice = 'line' | 'bar' | 'scatter' | 'event' | 'bp_band';

/** One series chosen in the chart builder with display metadata. */
export interface SelectedSeries {
  seriesId: string;
  seriesType: 'health_marker' | 'symptom';
  responseType: 'numeric' | 'boolean' | 'severity';
  isBloodPressure: boolean;
  label: string;
  unit?: string;
  chartType: ChartTypeChoice;
  /** Assigned automatically from {@link INSIGHT_SERIES_SLOT_COLORS}; not user-configurable. */
  color: string;
}

/** Props for {@link InsightSeriesPicker}. */
export interface InsightSeriesPickerProps {
  manifest: ChartManifestRow[];
  value: SelectedSeries[];
  onChange: (series: SelectedSeries[]) => void;
}
