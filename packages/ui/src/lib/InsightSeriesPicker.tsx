'use client';

import {
  useEffect,
  useId,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type SelectHTMLAttributes,
} from 'react';
import { useFocusRing } from './hooks/useFocusRing.js';
import {
  canAddAnotherSeries,
  chartTypeChoiceLabel,
  computeVisibleSlotCount,
  createSelectedSeriesFromManifestRow,
  filterChartableManifestRows,
  getChartTypeChoicesForManifestRow,
  isChartTypeSelectorHidden,
  MAX_SERIES_SLOTS,
  mergeSeriesSelectionAtSlot,
  wouldManifestRowExceedDistinctNonBpValueUnitLimit,
} from './insight-series-picker-utils.js';
import type {
  ChartableManifestRow,
  ChartTypeChoice,
  InsightSeriesPickerProps,
  SelectedSeries,
} from './InsightSeriesPicker.types.js';

export type {
  ChartManifestRow,
  ChartTypeChoice,
  InsightSeriesPickerProps,
  SelectedSeries,
} from './InsightSeriesPicker.types.js';

function pickerSelectClassName(highContrast: boolean): string {
  return [
    'min-h-11 w-full rounded-lg bg-app-surface px-3 text-base text-app-ink outline-none transition',
    'disabled:cursor-not-allowed',
    highContrast
      ? 'border-2 border-app-ink font-semibold shadow-none disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-app-ink focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg'
      : 'border border-app-border shadow-inner disabled:text-app-muted disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-app-ring',
  ].join(' ');
}

function pickerButtonClassName(highContrast: boolean): string {
  return [
    'inline-flex min-h-11 min-w-11 items-center justify-center self-start rounded-lg bg-app-surface px-4 text-base text-app-ink',
    'transition hover:bg-[var(--app-nav-hover-bg)] outline-none focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg',
    highContrast
      ? 'border-2 border-app-ink font-bold shadow-none focus-visible:ring-2 focus-visible:ring-app-ink'
      : 'border border-app-border font-semibold shadow-sm focus-visible:ring-2 focus-visible:ring-app-ring',
  ].join(' ');
}

function pickerFocusRingClassName(highContrast: boolean): string {
  return highContrast
    ? 'ring-2 ring-app-ink ring-offset-2 ring-offset-app-bg'
    : 'ring-2 ring-app-ring ring-offset-2 ring-offset-app-bg';
}

function PickerSelect({
  className,
  highContrast = false,
  onFocus,
  onBlur,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { highContrast?: boolean }) {
  const { focused, onFocus: onFocusRing, onBlur: onBlurRing } = useFocusRing();

  return (
    <select
      {...rest}
      className={[
        pickerSelectClassName(highContrast),
        focused ? pickerFocusRingClassName(highContrast) : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      onFocus={(event) => {
        onFocusRing();
        onFocus?.(event);
      }}
      onBlur={(event) => {
        onBlurRing();
        onBlur?.(event);
      }}
    />
  );
}

function PickerButton({
  className,
  highContrast = false,
  onFocus,
  onBlur,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { highContrast?: boolean }) {
  const { focused, onFocus: onFocusRing, onBlur: onBlurRing } = useFocusRing();

  return (
    <button
      {...rest}
      className={[
        pickerButtonClassName(highContrast),
        focused ? pickerFocusRingClassName(highContrast) : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      onFocus={(event) => {
        onFocusRing();
        onFocus?.(event);
      }}
      onBlur={(event) => {
        onBlurRing();
        onBlur?.(event);
      }}
    />
  );
}

function findManifestRow(
  manifest: ChartableManifestRow[],
  seriesId: string,
): ChartableManifestRow | undefined {
  return manifest.find((row) => row.series_id === seriesId);
}

/**
 * Accessible label for the slot remove/clear control.
 * Slot 1 clears in place; slots 2–3 remove the slot from view.
 *
 * @param slotIndex - Zero-based slot index (0–2).
 * @returns Button text matching the action.
 */
function seriesSlotActionLabel(slotIndex: number): string {
  if (slotIndex === 0) {
    return 'Clear series 1';
  }
  return `Remove series ${slotIndex + 1}`;
}

/** Enforces the chart builder maximum of three selected series. */
function clampSeriesValue(value: SelectedSeries[]): SelectedSeries[] {
  return value.slice(0, MAX_SERIES_SLOTS);
}

function optionsForSlot(
  manifest: ChartableManifestRow[],
  value: SelectedSeries[],
  slotIndex: number,
): ChartableManifestRow[] {
  const selectedElsewhere = new Set(
    value
      .filter((_, index) => index !== slotIndex)
      .map((series) => series.seriesId),
  );
  return manifest.filter((row) => {
    if (selectedElsewhere.has(row.series_id)) {
      return false;
    }
    return !wouldManifestRowExceedDistinctNonBpValueUnitLimit(
      value,
      row,
      slotIndex,
    );
  });
}

/**
 * Series and chart-type picker for the insight chart builder (web only).
 * Supports up to three series with progressive slot disclosure.
 * Uses semantic `app-*` tokens from the host app `global.css` (light/dark via `html.dark`).
 * When `highContrast` is true, slots, labels, selects, buttons, and focus rings use stronger
 * `app-ink` borders and rings for the documented high-contrast presentation.
 *
 * @param props - Manifest rows, selected series, and change handler.
 * @returns Accessible form controls for series selection.
 */
export function InsightSeriesPicker({
  manifest,
  value,
  onChange,
  highContrast = false,
}: InsightSeriesPickerProps) {
  const seriesValue = useMemo(() => clampSeriesValue(value), [value]);
  const chartableManifest = useMemo(
    () => filterChartableManifestRows(manifest),
    [manifest],
  );

  useEffect(() => {
    if (value.length > MAX_SERIES_SLOTS) {
      onChange(clampSeriesValue(value));
    }
  }, [value, onChange]);

  const baseId = useId().replace(/:/g, '');
  const [revealedSlotCount, setRevealedSlotCount] = useState(() =>
    Math.min(MAX_SERIES_SLOTS, Math.max(1, seriesValue.length)),
  );

  useEffect(() => {
    setRevealedSlotCount((current) => {
      const nextUnfilledCap =
        seriesValue.length === 0
          ? 1
          : Math.min(MAX_SERIES_SLOTS, seriesValue.length + 1);
      const minForFilled = Math.max(1, seriesValue.length);
      return Math.min(
        MAX_SERIES_SLOTS,
        Math.max(minForFilled, Math.min(current, nextUnfilledCap)),
      );
    });
  }, [seriesValue.length]);

  const visibleSlotCount = computeVisibleSlotCount(
    seriesValue,
    revealedSlotCount,
  );
  const showAddAnother = canAddAnotherSeries(seriesValue, visibleSlotCount);

  const handleAddAnother = () => {
    setRevealedSlotCount((current) => Math.min(MAX_SERIES_SLOTS, current + 1));
  };

  const handleSeriesChange = (slotIndex: number, seriesId: string) => {
    if (!seriesId) {
      onChange(clampSeriesValue(seriesValue.slice(0, slotIndex)));
      setRevealedSlotCount(Math.max(1, slotIndex));
      return;
    }

    const row = findManifestRow(chartableManifest, seriesId);
    if (!row) {
      return;
    }

    const selected = createSelectedSeriesFromManifestRow(row, slotIndex);
    if (
      !selected ||
      wouldManifestRowExceedDistinctNonBpValueUnitLimit(
        seriesValue,
        row,
        slotIndex,
      )
    ) {
      return;
    }

    onChange(
      clampSeriesValue(
        mergeSeriesSelectionAtSlot(seriesValue, slotIndex, selected),
      ),
    );
  };

  const handleChartTypeChange = (
    slotIndex: number,
    chartType: ChartTypeChoice,
  ) => {
    const current = seriesValue[slotIndex];
    if (!current) {
      return;
    }
    const row = findManifestRow(chartableManifest, current.seriesId);
    if (!row) {
      return;
    }
    const selected = createSelectedSeriesFromManifestRow(
      row,
      slotIndex,
      chartType,
    );
    if (!selected) {
      return;
    }

    const next = seriesValue.slice();
    next[slotIndex] = selected;
    onChange(clampSeriesValue(next));
  };

  const handleRemove = (slotIndex: number) => {
    onChange(clampSeriesValue(seriesValue.slice(0, slotIndex)));
    setRevealedSlotCount(Math.max(1, slotIndex));
  };

  const slotSurfaceClassName = [
    'mb-3 flex flex-col gap-3 rounded-lg bg-app-surface p-3',
    highContrast
      ? 'border-2 border-app-ink shadow-none ring-2 ring-app-ink'
      : 'border border-app-border/90 shadow-sm ring-1 ring-[color:var(--app-ring-slate)]',
  ].join(' ');

  const labelClassName = highContrast
    ? 'text-base font-bold text-app-ink'
    : 'text-base font-semibold text-app-ink';

  const legendClassName = highContrast
    ? 'mb-2 text-base font-bold text-app-ink'
    : 'mb-2 text-base font-semibold text-app-ink';

  const slotTitleClassName = highContrast
    ? 'flex items-center gap-2 text-base font-bold text-app-ink'
    : 'flex items-center gap-2 text-base font-semibold text-app-ink';

  const colorSwatchClassName = highContrast
    ? 'h-4 w-4 shrink-0 rounded border-2 border-app-ink'
    : 'h-4 w-4 shrink-0 rounded border border-app-border';

  return (
    <div
      className={
        highContrast
          ? 'flex flex-col gap-4 font-medium text-app-ink'
          : 'flex flex-col gap-4 text-app-ink'
      }
    >
      <fieldset className="m-0 border-0 p-0">
        <legend className={legendClassName}>Chart series</legend>

        {Array.from({ length: visibleSlotCount }, (_, slotIndex) => {
          const selected = seriesValue[slotIndex];
          const row = selected
            ? findManifestRow(chartableManifest, selected.seriesId)
            : undefined;
          const seriesSelectId = `${baseId}-series-${slotIndex}`;
          const chartTypeSelectId = `${baseId}-chart-type-${slotIndex}`;
          const slotOptions = optionsForSlot(
            chartableManifest,
            seriesValue,
            slotIndex,
          );
          const chartTypeHidden = row ? isChartTypeSelectorHidden(row) : true;

          return (
            <div
              key={slotIndex}
              className={slotSurfaceClassName}
              role="group"
              aria-labelledby={`${baseId}-slot-${slotIndex}-legend`}
            >
              <div
                id={`${baseId}-slot-${slotIndex}-legend`}
                className={slotTitleClassName}
              >
                {selected ? (
                  <>
                    <span
                      className={colorSwatchClassName}
                      style={{ backgroundColor: selected.color }}
                      aria-hidden
                    />
                    <span>
                      Series {slotIndex + 1}: {selected.label}
                    </span>
                  </>
                ) : (
                  <span>Series {slotIndex + 1}</span>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor={seriesSelectId} className={labelClassName}>
                  {`Data series ${slotIndex + 1}`}
                </label>
                <PickerSelect
                  id={seriesSelectId}
                  highContrast={highContrast}
                  value={selected?.seriesId ?? ''}
                  onChange={(event) =>
                    handleSeriesChange(slotIndex, event.target.value)
                  }
                >
                  <option value="">Select a series…</option>
                  {slotOptions.map((option) => (
                    <option key={option.series_id} value={option.series_id}>
                      {option.label}
                      {option.unit ? ` (${option.unit})` : ''}
                    </option>
                  ))}
                </PickerSelect>
              </div>

              {!chartTypeHidden && row ? (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={chartTypeSelectId} className={labelClassName}>
                    {`Chart type for series ${slotIndex + 1}`}
                  </label>
                  <PickerSelect
                    id={chartTypeSelectId}
                    highContrast={highContrast}
                    value={selected?.chartType ?? ''}
                    onChange={(event) =>
                      handleChartTypeChange(
                        slotIndex,
                        event.target.value as ChartTypeChoice,
                      )
                    }
                  >
                    {getChartTypeChoicesForManifestRow(row).map((choice) => (
                      <option key={choice} value={choice}>
                        {chartTypeChoiceLabel(choice)}
                      </option>
                    ))}
                  </PickerSelect>
                </div>
              ) : null}

              <PickerButton
                type="button"
                highContrast={highContrast}
                onClick={() => handleRemove(slotIndex)}
              >
                {seriesSlotActionLabel(slotIndex)}
              </PickerButton>
            </div>
          );
        })}
      </fieldset>

      {showAddAnother ? (
        <PickerButton
          type="button"
          highContrast={highContrast}
          onClick={handleAddAnother}
        >
          Add another series
        </PickerButton>
      ) : null}
    </div>
  );
}
