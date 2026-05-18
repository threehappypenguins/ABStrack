'use client';

import {
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type SelectHTMLAttributes,
  type ButtonHTMLAttributes,
} from 'react';
import { useFocusRing } from './hooks/useFocusRing.js';
import {
  defaultPalette,
  highContrastPalette,
  type UiPalette,
} from './styles/theme.js';
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

function insightSeriesPickerStyles(palette: UiPalette) {
  const field: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  };

  const label: CSSProperties = {
    fontSize: 16,
    fontWeight: 600,
    color: palette.text,
  };

  const select: CSSProperties = {
    minHeight: 44,
    fontSize: 16,
    padding: '8px 12px',
    borderRadius: 8,
    border: `1px solid ${palette.border}`,
    backgroundColor: palette.surface,
    color: palette.text,
  };

  const slot: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: 12,
    border: `1px solid ${palette.border}`,
    borderRadius: 8,
    backgroundColor: palette.surface,
  };

  const root: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    color: palette.text,
  };

  const secondaryButton: CSSProperties = {
    alignSelf: 'flex-start',
    minHeight: 44,
    minWidth: 44,
    padding: '8px 16px',
    fontSize: 16,
    borderRadius: 8,
    border: `1px solid ${palette.border}`,
    backgroundColor: palette.surface,
    color: palette.text,
    cursor: 'pointer',
  };

  const colorSwatch = (color: string): CSSProperties => ({
    width: 16,
    height: 16,
    borderRadius: 4,
    backgroundColor: color,
    border: `1px solid ${palette.mutedText}`,
    flexShrink: 0,
  });

  const focusRing = (focused: boolean): CSSProperties =>
    focused
      ? {
          outline: '2px solid',
          outlineColor: palette.focusRing,
          outlineOffset: 2,
        }
      : {};

  return {
    field,
    label,
    select,
    slot,
    root,
    secondaryButton,
    colorSwatch,
    focusRing,
  };
}

function PickerSelect({
  palette,
  style,
  onFocus,
  onBlur,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { palette: UiPalette }) {
  const { focused, onFocus: onFocusRing, onBlur: onBlurRing } = useFocusRing();
  const styles = insightSeriesPickerStyles(palette);

  return (
    <select
      {...rest}
      style={{
        ...styles.select,
        ...style,
        ...styles.focusRing(focused),
      }}
      onFocus={(event) => {
        onFocusRing(event as never);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        onBlurRing(event as never);
        onBlur?.(event);
      }}
    />
  );
}

function PickerButton({
  palette,
  style,
  onFocus,
  onBlur,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { palette: UiPalette }) {
  const { focused, onFocus: onFocusRing, onBlur: onBlurRing } = useFocusRing();
  const styles = insightSeriesPickerStyles(palette);

  return (
    <button
      {...rest}
      style={{
        ...styles.secondaryButton,
        ...style,
        ...styles.focusRing(focused),
      }}
      onFocus={(event) => {
        onFocusRing(event as never);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        onBlurRing(event as never);
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
  return manifest.filter((row) => !selectedElsewhere.has(row.series_id));
}

/**
 * Series and chart-type picker for the insight chart builder (web only).
 * Supports up to three series with progressive slot disclosure.
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
  const palette = highContrast ? highContrastPalette : defaultPalette;
  const styles = useMemo(() => insightSeriesPickerStyles(palette), [palette]);

  const seriesValue = useMemo(() => clampSeriesValue(value), [value]);
  const chartableManifest = useMemo(
    () => filterChartableManifestRows(manifest),
    [manifest],
  );
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
    if (!selected) {
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

  return (
    <div style={styles.root}>
      <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend style={{ ...styles.label, marginBottom: 8 }}>
          Chart series
        </legend>

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
              style={{ ...styles.slot, marginBottom: 12 }}
              role="group"
              aria-labelledby={`${baseId}-slot-${slotIndex}-legend`}
            >
              <div
                id={`${baseId}-slot-${slotIndex}-legend`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontWeight: 600,
                  fontSize: 16,
                }}
              >
                {selected ? (
                  <>
                    <span
                      style={styles.colorSwatch(selected.color)}
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

              <div style={styles.field}>
                <label htmlFor={seriesSelectId} style={styles.label}>
                  {`Data series ${slotIndex + 1}`}
                </label>
                <PickerSelect
                  palette={palette}
                  id={seriesSelectId}
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
                <div style={styles.field}>
                  <label htmlFor={chartTypeSelectId} style={styles.label}>
                    {`Chart type for series ${slotIndex + 1}`}
                  </label>
                  <PickerSelect
                    palette={palette}
                    id={chartTypeSelectId}
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
                palette={palette}
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
          palette={palette}
          onClick={handleAddAnother}
        >
          Add another series
        </PickerButton>
      ) : null}
    </div>
  );
}
