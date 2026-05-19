import type { InsightDateRange } from './insight-date-range-picker-utils.js';

/** Props for {@link InsightDateRangePicker}. */
export interface InsightDateRangePickerProps {
  /** Current inclusive local-date range. */
  value: InsightDateRange;
  /** Called when the user picks a preset or completes a calendar range. */
  onChange: (range: InsightDateRange) => void;
}
