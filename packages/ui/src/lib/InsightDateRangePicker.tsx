'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
import { useAnnounce } from './a11y/LiveAnnouncer.js';
import { useFocusRing } from './hooks/useFocusRing.js';
import {
  formatInsightDateRangeAnnouncement,
  getInsightDateRangeDisabledMatchers,
  getInsightDateRangePreset,
  INSIGHT_DATE_RANGE_MAX_NIGHTS,
  INSIGHT_DATE_RANGE_PRESETS,
  normalizeInsightDateRange,
  type InsightDateRange,
  type InsightDateRangePresetId,
} from './insight-date-range-picker-utils.js';

export type { InsightDateRangePresetId } from './insight-date-range-picker-utils.js';

/** Props for {@link InsightDateRangePicker}. */
export interface InsightDateRangePickerProps {
  /** Current inclusive local-date range. */
  value: InsightDateRange;
  /** Called when the user picks a preset or completes a calendar range. */
  onChange: (range: InsightDateRange) => void;
}

const dayPickerClassNames = {
  root: 'relative text-app-ink',
  months: 'flex flex-col gap-4',
  month: 'space-y-4',
  month_caption: 'flex justify-center pt-1 relative items-center',
  caption_label: 'text-base font-semibold text-app-ink',
  nav: 'flex items-center gap-1',
  button_previous:
    'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-app-border bg-app-surface text-app-ink hover:bg-app-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-ring',
  button_next:
    'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-app-border bg-app-surface text-app-ink hover:bg-app-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-ring',
  month_grid: 'w-full border-collapse',
  weekdays: 'flex',
  weekday: 'w-11 rounded-md text-sm font-medium text-app-muted',
  week: 'mt-1 flex w-full',
  day: 'relative flex h-11 w-11 items-center justify-center p-0 text-center text-sm',
  day_button:
    'flex h-11 w-11 items-center justify-center rounded-lg font-medium text-app-ink hover:bg-app-primary-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-ring disabled:cursor-not-allowed disabled:text-app-muted disabled:opacity-50',
  selected:
    '[&>button]:bg-app-primary [&>button]:text-white [&>button]:hover:bg-app-primary',
  range_start: '[&>button]:rounded-l-lg [&>button]:rounded-r-none',
  range_end: '[&>button]:rounded-r-lg [&>button]:rounded-l-none',
  range_middle:
    '[&>button]:rounded-none [&>button]:bg-app-primary-soft [&>button]:text-app-ink',
  today: '[&>button]:font-bold [&>button]:underline',
  outside: '[&>button]:text-app-muted [&>button]:opacity-50',
  disabled: '[&>button]:cursor-not-allowed [&>button]:opacity-40',
} as const;

function PresetButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  const { focused, onFocus, onBlur } = useFocusRing();

  return (
    <button
      type="button"
      onClick={onClick}
      onFocus={onFocus}
      onBlur={onBlur}
      className={[
        'min-h-11 min-w-11 rounded-lg border border-app-border bg-app-surface px-4 text-base font-semibold text-app-ink',
        'hover:bg-app-bg',
        focused
          ? 'outline outline-2 outline-offset-2 outline-app-ring'
          : 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-ring',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

/**
 * Accessible date range picker for the insight chart builder (web only).
 * Preset shortcuts, `react-day-picker` range calendar, 2-year max span, no future dates.
 *
 * Consuming Next.js apps must import `react-day-picker/style.css` from their global CSS
 * entry (see `apps/web` and `apps/practitioner` `global.css`).
 *
 * @param props - Controlled range value and change handler.
 * @returns Preset toolbar and range calendar.
 */
export function InsightDateRangePicker({
  value,
  onChange,
}: InsightDateRangePickerProps) {
  const { announce } = useAnnounce();
  const baseId = useId().replace(/:/g, '');
  const lastAnnouncedKey = useRef('');
  const [month, setMonth] = useState(() => value.to);

  useEffect(() => {
    setMonth(value.to);
  }, [value.from, value.to]);

  const commitRange = useCallback(
    (next: InsightDateRange) => {
      const normalized = normalizeInsightDateRange(next);
      setMonth(normalized.to);
      onChange(normalized);
      const key = `${normalized.from.getTime()}-${normalized.to.getTime()}`;
      if (key !== lastAnnouncedKey.current) {
        lastAnnouncedKey.current = key;
        announce(formatInsightDateRangeAnnouncement(normalized));
      }
    },
    [announce, onChange],
  );

  const handlePreset = (presetId: InsightDateRangePresetId) => {
    commitRange(getInsightDateRangePreset(presetId));
  };

  const handleCalendarSelect = (range: DateRange | undefined) => {
    if (!range?.from || !range.to) {
      return;
    }
    commitRange({ from: range.from, to: range.to });
  };

  const selected: DateRange = {
    from: value.from,
    to: value.to,
  };

  return (
    <div
      className="flex flex-col gap-4 text-app-ink"
      role="group"
      aria-labelledby={`${baseId}-legend`}
    >
      <div
        id={`${baseId}-legend`}
        className="text-base font-semibold text-app-ink"
      >
        Date range
      </div>

      <div
        className="flex flex-wrap gap-2"
        role="toolbar"
        aria-label="Date range presets"
      >
        {INSIGHT_DATE_RANGE_PRESETS.map((preset) => (
          <PresetButton
            key={preset.id}
            label={preset.label}
            onClick={() => handlePreset(preset.id)}
          />
        ))}
      </div>

      <DayPicker
        mode="range"
        selected={selected}
        onSelect={handleCalendarSelect}
        disabled={getInsightDateRangeDisabledMatchers()}
        max={INSIGHT_DATE_RANGE_MAX_NIGHTS}
        month={month}
        onMonthChange={setMonth}
        classNames={dayPickerClassNames}
        aria-label="Chart date range calendar"
      />
    </div>
  );
}
