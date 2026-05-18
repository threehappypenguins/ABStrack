'use client';

import { useEffect, useId, useState, type CSSProperties } from 'react';
import {
  canAddAnotherSeries,
  chartTypeChoiceLabel,
  computeVisibleSlotCount,
  createSelectedSeriesFromManifestRow,
  getChartTypeChoicesForManifestRow,
  isChartTypeSelectorHidden,
} from './insight-series-picker-utils.js';
import type {
  ChartManifestRow,
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

export {
  INSIGHT_SERIES_SLOT_COLORS,
  canAddAnotherSeries,
  chartTypeChoiceLabel,
  computeVisibleSlotCount,
  createSelectedSeriesFromManifestRow,
  defaultChartTypeForManifestRow,
  getChartTypeChoicesForManifestRow,
  isChartTypeSelectorHidden,
} from './insight-series-picker-utils.js';

const MAX_SERIES_SLOTS = 3;

const fieldStyles: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const labelStyles: CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
};

const selectStyles: CSSProperties = {
  minHeight: 44,
  fontSize: 16,
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #d4d4d4',
};

const slotStyles: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 12,
  border: '1px solid #d4d4d4',
  borderRadius: 8,
};

const rootStyles: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const addButtonStyles: CSSProperties = {
  alignSelf: 'flex-start',
  minHeight: 44,
  minWidth: 44,
  padding: '8px 16px',
  fontSize: 16,
  borderRadius: 8,
  border: '1px solid #d4d4d4',
  background: '#ffffff',
  cursor: 'pointer',
};

const removeButtonStyles: CSSProperties = {
  alignSelf: 'flex-start',
  minHeight: 44,
  minWidth: 44,
  padding: '8px 16px',
  fontSize: 16,
  borderRadius: 8,
  border: '1px solid #d4d4d4',
  background: '#ffffff',
  cursor: 'pointer',
};

const colorSwatchStyles = (color: string): CSSProperties => ({
  width: 16,
  height: 16,
  borderRadius: 4,
  backgroundColor: color,
  border: '1px solid #525252',
  flexShrink: 0,
});

function findManifestRow(
  manifest: ChartManifestRow[],
  seriesId: string,
): ChartManifestRow | undefined {
  return manifest.find((row) => row.series_id === seriesId);
}

function optionsForSlot(
  manifest: ChartManifestRow[],
  value: SelectedSeries[],
  slotIndex: number,
): ChartManifestRow[] {
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
}: InsightSeriesPickerProps) {
  const baseId = useId().replace(/:/g, '');
  const [revealedSlotCount, setRevealedSlotCount] = useState(() =>
    Math.min(MAX_SERIES_SLOTS, Math.max(1, value.length)),
  );

  useEffect(() => {
    setRevealedSlotCount((current) =>
      Math.max(current, Math.min(MAX_SERIES_SLOTS, Math.max(1, value.length))),
    );
  }, [value.length]);

  const visibleSlotCount = computeVisibleSlotCount(value, revealedSlotCount);
  const showAddAnother = canAddAnotherSeries(value, visibleSlotCount);

  const handleAddAnother = () => {
    setRevealedSlotCount((current) => Math.min(MAX_SERIES_SLOTS, current + 1));
  };

  const handleSeriesChange = (slotIndex: number, seriesId: string) => {
    if (!seriesId) {
      onChange(value.slice(0, slotIndex));
      setRevealedSlotCount(1);
      return;
    }

    const row = findManifestRow(manifest, seriesId);
    if (!row) {
      return;
    }

    const next = value.slice(0, slotIndex);
    next[slotIndex] = createSelectedSeriesFromManifestRow(row, slotIndex);
    onChange(next.slice(0, MAX_SERIES_SLOTS));
  };

  const handleChartTypeChange = (
    slotIndex: number,
    chartType: ChartTypeChoice,
  ) => {
    const current = value[slotIndex];
    if (!current) {
      return;
    }
    const row = findManifestRow(manifest, current.seriesId);
    if (!row) {
      return;
    }
    const next = [...value];
    next[slotIndex] = createSelectedSeriesFromManifestRow(
      row,
      slotIndex,
      chartType,
    );
    onChange(next);
  };

  const handleRemove = (slotIndex: number) => {
    onChange(value.slice(0, slotIndex));
    setRevealedSlotCount(Math.max(1, slotIndex));
  };

  return (
    <div style={rootStyles}>
      <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend style={{ ...labelStyles, marginBottom: 8 }}>
          Chart series
        </legend>

        {Array.from({ length: visibleSlotCount }, (_, slotIndex) => {
          const selected = value[slotIndex];
          const row = selected
            ? findManifestRow(manifest, selected.seriesId)
            : undefined;
          const seriesSelectId = `${baseId}-series-${slotIndex}`;
          const chartTypeSelectId = `${baseId}-chart-type-${slotIndex}`;
          const slotOptions = optionsForSlot(manifest, value, slotIndex);
          const chartTypeHidden = row ? isChartTypeSelectorHidden(row) : true;

          return (
            <div
              key={slotIndex}
              style={{ ...slotStyles, marginBottom: 12 }}
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
                      style={colorSwatchStyles(selected.color)}
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

              <div style={fieldStyles}>
                <label htmlFor={seriesSelectId} style={labelStyles}>
                  {`Data series ${slotIndex + 1}`}
                </label>
                <select
                  id={seriesSelectId}
                  style={selectStyles}
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
                </select>
              </div>

              {!chartTypeHidden && row ? (
                <div style={fieldStyles}>
                  <label htmlFor={chartTypeSelectId} style={labelStyles}>
                    {`Chart type for series ${slotIndex + 1}`}
                  </label>
                  <select
                    id={chartTypeSelectId}
                    style={selectStyles}
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
                  </select>
                </div>
              ) : null}

              <button
                type="button"
                style={removeButtonStyles}
                onClick={() => handleRemove(slotIndex)}
              >
                {selected
                  ? `Remove series ${slotIndex + 1}`
                  : `Clear series ${slotIndex + 1}`}
              </button>
            </div>
          );
        })}
      </fieldset>

      {showAddAnother ? (
        <button
          type="button"
          style={addButtonStyles}
          onClick={handleAddAnother}
        >
          Add another series
        </button>
      ) : null}
    </div>
  );
}
