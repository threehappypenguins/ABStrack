import type { HealthMarkerRow, PresetHealthMarkerRow } from './types.js';
import { PRESET_HEALTH_MARKER_KIND_LABELS } from './types.js';

export type MarkerDraft = {
  value: string;
  systolic: string;
  diastolic: string;
  notes: string;
};

type MeasurementDraftResult =
  | {
      ok: true;
      valueNumeric: number | null;
      systolicNumeric: number | null;
      diastolicNumeric: number | null;
    }
  | { ok: false; message: string };

function normalizeNullable(value: string | null | undefined): string | null {
  const next = value?.trim() ?? '';
  return next.length > 0 ? next : null;
}

export function markerLineTitle(line: PresetHealthMarkerRow): string {
  if (line.marker_kind !== 'custom') {
    return PRESET_HEALTH_MARKER_KIND_LABELS[line.marker_kind];
  }
  const customName = normalizeNullable(line.custom_name);
  return customName ?? PRESET_HEALTH_MARKER_KIND_LABELS.custom;
}

export function createDraftFromMarker(
  row: HealthMarkerRow | null,
): MarkerDraft {
  return {
    value: row?.value_numeric != null ? String(row.value_numeric) : '',
    systolic: row?.systolic_numeric != null ? String(row.systolic_numeric) : '',
    diastolic:
      row?.diastolic_numeric != null ? String(row.diastolic_numeric) : '',
    notes: row?.notes ?? '',
  };
}

export function parseMeasurementDraftForSave(
  line: PresetHealthMarkerRow,
  draft: MarkerDraft,
): MeasurementDraftResult {
  const value = parseOptionalNumber(draft.value);
  const systolic = parseOptionalNumber(draft.systolic);
  const diastolic = parseOptionalNumber(draft.diastolic);

  if (line.marker_kind === 'blood_pressure') {
    if (systolic == null || diastolic == null) {
      return {
        ok: false,
        message:
          'Enter both systolic and diastolic blood pressure values to continue.',
      };
    }
    if (Number.isNaN(systolic) || Number.isNaN(diastolic)) {
      return {
        ok: false,
        message:
          'Blood pressure values must be valid numbers (for example 120 and 80).',
      };
    }
    return {
      ok: true,
      valueNumeric: null,
      systolicNumeric: systolic,
      diastolicNumeric: diastolic,
    };
  }
  if (value == null) {
    return { ok: false, message: 'Enter a numeric value to continue.' };
  }
  if (Number.isNaN(value)) {
    return { ok: false, message: 'Value must be a valid number.' };
  }
  return {
    ok: true,
    valueNumeric: value,
    systolicNumeric: null,
    diastolicNumeric: null,
  };
}

export function minForPresetMarkerValueInput(
  kind: PresetHealthMarkerRow['marker_kind'],
): number | undefined {
  return kind === 'custom' ? undefined : 0;
}

function parseOptionalNumber(raw: string | undefined): number | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return null;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : Number.NaN;
}
