/**
 * Shared domain enums and table-aligned row shapes for ABStrack.
 * Values mirror `supabase/migrations/20260327120000_abstrack_core_schema.sql`
 * and PRD vocabulary (plaintext columns — serializable primitives only).
 */

// ---------------------------------------------------------------------------
// User roles (profiles.app_role — PRD “Users & Roles”)
// ---------------------------------------------------------------------------

export const APP_ROLES = ['patient', 'caretaker', 'practitioner'] as const;
export type AppRole = (typeof APP_ROLES)[number];

// ---------------------------------------------------------------------------
// Episode type (episodes.episode_type — PRD §4)
// ---------------------------------------------------------------------------

export const EPISODE_TYPES = ['ABS', 'Other'] as const;
export type EpisodeType = (typeof EPISODE_TYPES)[number];

// ---------------------------------------------------------------------------
// Meal tags (food_diary_entries.meal_tag — PRD §6)
// ---------------------------------------------------------------------------

export const MEAL_TAGS = [
  'Breakfast',
  'Lunch',
  'Dinner',
  'Snack',
  'Other',
] as const;
export type MealTag = (typeof MEAL_TAGS)[number];

// ---------------------------------------------------------------------------
// Symptom response types (preset_symptoms / episode_symptoms — PRD §2)
// ---------------------------------------------------------------------------

export const SYMPTOM_RESPONSE_TYPES = [
  'yes_no',
  'severity_scale',
  'free_text',
  'photo',
  'video',
] as const;
export type SymptomResponseType = (typeof SYMPTOM_RESPONSE_TYPES)[number];

// ---------------------------------------------------------------------------
// Health marker kinds
// ---------------------------------------------------------------------------

/** Lines in `preset_health_markers` (subset of measurement kinds). */
export const PRESET_HEALTH_MARKER_KINDS = [
  'bac',
  'blood_glucose',
  'blood_pressure',
  'heart_rate',
  'weight',
  'custom',
] as const;
export type PresetHealthMarkerKind =
  (typeof PRESET_HEALTH_MARKER_KINDS)[number];

/**
 * Short labels for {@link PresetHealthMarkerKind} values (list rows, selects, summaries).
 */
export const PRESET_HEALTH_MARKER_KIND_LABELS: Record<
  PresetHealthMarkerKind,
  string
> = {
  bac: 'BAC',
  blood_glucose: 'Glucose',
  blood_pressure: 'Blood pressure',
  heart_rate: 'Heart rate',
  weight: 'Weight',
  custom: 'Custom',
};

/** Rows in `health_markers` (includes wellness-only kind). */
export const HEALTH_MARKER_KINDS = [
  ...PRESET_HEALTH_MARKER_KINDS,
  'wellness_mood',
] as const;
export type HealthMarkerKind = (typeof HEALTH_MARKER_KINDS)[number];

// ---------------------------------------------------------------------------
// Episode media
// ---------------------------------------------------------------------------

export const MEDIA_TYPES = ['photo', 'video'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

// ---------------------------------------------------------------------------
// Audit log actor role (access_log.actor_role — broader than app profiles)
// ---------------------------------------------------------------------------

export const ACCESS_LOG_ACTOR_ROLES = [
  'patient',
  'caretaker',
  'practitioner',
  'system',
  'service',
] as const;
export type AccessLogActorRole = (typeof ACCESS_LOG_ACTOR_ROLES)[number];

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isAppRole(value: unknown): value is AppRole {
  return (
    typeof value === 'string' &&
    (APP_ROLES as readonly string[]).includes(value)
  );
}

export function isEpisodeType(value: unknown): value is EpisodeType {
  return (
    typeof value === 'string' &&
    (EPISODE_TYPES as readonly string[]).includes(value)
  );
}

export function isMealTag(value: unknown): value is MealTag {
  return (
    typeof value === 'string' &&
    (MEAL_TAGS as readonly string[]).includes(value)
  );
}

export function isSymptomResponseType(
  value: unknown,
): value is SymptomResponseType {
  return (
    typeof value === 'string' &&
    (SYMPTOM_RESPONSE_TYPES as readonly string[]).includes(value)
  );
}

export function isPresetHealthMarkerKind(
  value: unknown,
): value is PresetHealthMarkerKind {
  return (
    typeof value === 'string' &&
    (PRESET_HEALTH_MARKER_KINDS as readonly string[]).includes(value)
  );
}

export function isHealthMarkerKind(value: unknown): value is HealthMarkerKind {
  return (
    typeof value === 'string' &&
    (HEALTH_MARKER_KINDS as readonly string[]).includes(value)
  );
}

export function isMediaType(value: unknown): value is MediaType {
  return (
    typeof value === 'string' &&
    (MEDIA_TYPES as readonly string[]).includes(value)
  );
}

export function isAccessLogActorRole(
  value: unknown,
): value is AccessLogActorRole {
  return (
    typeof value === 'string' &&
    (ACCESS_LOG_ACTOR_ROLES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Timestamps & IDs (Supabase / PostgREST JSON)
// ---------------------------------------------------------------------------

/** ISO 8601 timestamptz string from Postgres. */
export type IsoTimestamptz = string;

/** UUID string. */
export type Uuid = string;

// ---------------------------------------------------------------------------
// Row shapes (public schema)
// ---------------------------------------------------------------------------

export interface ProfileRow {
  id: Uuid;
  display_name: string | null;
  app_role: AppRole;
  created_at: IsoTimestamptz;
  updated_at: IsoTimestamptz;
}

export type ProfileInsert = {
  id: Uuid;
  app_role: AppRole;
  display_name?: string | null;
};

export type ProfileUpdate = Partial<
  Pick<ProfileRow, 'display_name' | 'app_role'>
>;

export interface SymptomPresetRow {
  id: Uuid;
  user_id: Uuid;
  name: string;
  created_at: IsoTimestamptz;
  updated_at: IsoTimestamptz;
}

export type SymptomPresetInsert = Pick<SymptomPresetRow, 'user_id' | 'name'> & {
  id?: Uuid;
};

export type SymptomPresetUpdate = Partial<Pick<SymptomPresetRow, 'name'>>;

export interface PresetSymptomRow {
  id: Uuid;
  preset_id: Uuid;
  sort_order: number;
  symptom_name: string;
  response_type: SymptomResponseType;
  prompt_instruction: string | null;
  created_at: IsoTimestamptz;
  updated_at: IsoTimestamptz;
}

export type PresetSymptomInsert = Pick<
  PresetSymptomRow,
  'preset_id' | 'sort_order' | 'symptom_name' | 'response_type'
> & {
  id?: Uuid;
  prompt_instruction?: string | null;
};

export type PresetSymptomUpdate = Partial<
  Pick<
    PresetSymptomRow,
    'sort_order' | 'symptom_name' | 'response_type' | 'prompt_instruction'
  >
>;

export interface HealthMarkerPresetRow {
  id: Uuid;
  user_id: Uuid;
  name: string;
  created_at: IsoTimestamptz;
  updated_at: IsoTimestamptz;
}

export type HealthMarkerPresetInsert = Pick<
  HealthMarkerPresetRow,
  'user_id' | 'name'
> & {
  id?: Uuid;
};

export type HealthMarkerPresetUpdate = Partial<
  Pick<HealthMarkerPresetRow, 'name'>
>;

export interface PresetHealthMarkerRow {
  id: Uuid;
  preset_id: Uuid;
  sort_order: number;
  marker_kind: PresetHealthMarkerKind;
  custom_name: string | null;
  custom_unit: string | null;
  created_at: IsoTimestamptz;
  updated_at: IsoTimestamptz;
}

export type PresetHealthMarkerInsert = Pick<
  PresetHealthMarkerRow,
  'preset_id' | 'sort_order' | 'marker_kind'
> & {
  id?: Uuid;
  custom_name?: string | null;
  custom_unit?: string | null;
};

export type PresetHealthMarkerUpdate = Partial<
  Pick<
    PresetHealthMarkerRow,
    'sort_order' | 'marker_kind' | 'custom_name' | 'custom_unit'
  >
>;

/**
 * User-facing summary for one line in a health marker preset (ordered list and editor).
 *
 * @param line - Row from `preset_health_markers`.
 * @returns Display string (includes custom name/unit when `marker_kind` is `custom`).
 */
export function describePresetHealthMarkerLine(
  line: PresetHealthMarkerRow,
): string {
  if (line.marker_kind === 'custom') {
    const name = line.custom_name?.trim() ?? '';
    const unit = line.custom_unit?.trim() ?? '';
    if (name && unit) {
      return `${name} (${unit})`;
    }
    return `${PRESET_HEALTH_MARKER_KIND_LABELS.custom} (add name and unit)`;
  }
  return PRESET_HEALTH_MARKER_KIND_LABELS[line.marker_kind];
}

/**
 * Validates custom marker name and unit when {@link PresetHealthMarkerKind} is `custom`.
 *
 * @param markerKind - Selected marker kind.
 * @param customName - Draft name (trimmed inside).
 * @param customUnit - Draft unit (trimmed inside).
 * @returns User-facing error message, or `null` when valid / not applicable.
 */
export function validatePresetHealthMarkerCustomFields(
  markerKind: PresetHealthMarkerKind,
  customName: string,
  customUnit: string,
): string | null {
  if (markerKind !== 'custom') {
    return null;
  }
  if (!customName.trim()) {
    return 'Enter a name for this custom marker.';
  }
  if (!customUnit.trim()) {
    return 'Enter a unit (e.g. mg/dL, lb, bpm).';
  }
  return null;
}

export interface EpisodeRow {
  id: Uuid;
  user_id: Uuid;
  symptom_preset_id: Uuid | null;
  health_marker_preset_id: Uuid | null;
  episode_type: EpisodeType;
  episode_label: string | null;
  note: string | null;
  started_at: IsoTimestamptz;
  ended_at: IsoTimestamptz | null;
  created_at: IsoTimestamptz;
  updated_at: IsoTimestamptz;
}

export type EpisodeInsert = Pick<EpisodeRow, 'user_id' | 'started_at'> & {
  id?: Uuid;
  symptom_preset_id?: Uuid | null;
  health_marker_preset_id?: Uuid | null;
  episode_type?: EpisodeType;
  episode_label?: string | null;
  note?: string | null;
  ended_at?: IsoTimestamptz | null;
};

export type EpisodeUpdate = Partial<
  Pick<
    EpisodeRow,
    | 'symptom_preset_id'
    | 'health_marker_preset_id'
    | 'episode_type'
    | 'episode_label'
    | 'note'
    | 'started_at'
    | 'ended_at'
  >
>;

export interface EpisodeSymptomRow {
  id: Uuid;
  user_id: Uuid;
  episode_id: Uuid | null;
  preset_symptom_id: Uuid | null;
  symptom_name: string;
  response_type: SymptomResponseType;
  response_boolean: boolean | null;
  response_severity: number | null;
  response_text: string | null;
  sort_order: number;
  created_at: IsoTimestamptz;
  updated_at: IsoTimestamptz;
}

export type EpisodeSymptomInsert = Pick<
  EpisodeSymptomRow,
  'user_id' | 'symptom_name' | 'response_type'
> & {
  id?: Uuid;
  episode_id?: Uuid | null;
  preset_symptom_id?: Uuid | null;
  response_boolean?: boolean | null;
  response_severity?: number | null;
  response_text?: string | null;
  sort_order?: number;
};

export type EpisodeSymptomUpdate = Partial<
  Pick<
    EpisodeSymptomRow,
    | 'episode_id'
    | 'preset_symptom_id'
    | 'symptom_name'
    | 'response_type'
    | 'response_boolean'
    | 'response_severity'
    | 'response_text'
    | 'sort_order'
  >
>;

export interface HealthMarkerRow {
  id: Uuid;
  user_id: Uuid;
  episode_id: Uuid | null;
  /**
   * `preset_health_markers.id` when this row is tied to a template line.
   * The DB enforces: if `episode_id` is set, this must be non-null (`health_markers_episode_requires_preset_line`).
   * If `episode_id` is null (PRD §5 General Wellness Logging — vitals without an episode), this may still
   * be set when the user logs via a preset line, or null for rows that are not keyed to a line (e.g. wellness-only kinds).
   */
  preset_health_marker_id: Uuid | null;
  marker_kind: HealthMarkerKind;
  custom_name: string | null;
  /** DB-generated from `custom_name` for unique upsert keys; present on reads; omit on writes (see {@link HealthMarkerInsert}). */
  custom_name_key: string | null;
  custom_unit: string | null;
  /** DB-generated from `custom_unit` for unique upsert keys; present on reads; omit on writes (see {@link HealthMarkerInsert}). */
  custom_unit_key: string | null;
  value_numeric: number | null;
  systolic_numeric: number | null;
  diastolic_numeric: number | null;
  recorded_at: IsoTimestamptz;
  notes: string | null;
  created_at: IsoTimestamptz;
  updated_at: IsoTimestamptz;
}

export type HealthMarkerInsert = Pick<
  HealthMarkerRow,
  'user_id' | 'marker_kind' | 'recorded_at'
> & {
  id?: Uuid;
  episode_id?: Uuid | null;
  preset_health_marker_id?: Uuid | null;
  custom_name?: string | null;
  custom_unit?: string | null;
  value_numeric?: number | null;
  systolic_numeric?: number | null;
  diastolic_numeric?: number | null;
  notes?: string | null;
};

export type HealthMarkerUpdate = Partial<
  Pick<
    HealthMarkerRow,
    | 'episode_id'
    | 'preset_health_marker_id'
    | 'marker_kind'
    | 'custom_name'
    | 'custom_unit'
    | 'value_numeric'
    | 'systolic_numeric'
    | 'diastolic_numeric'
    | 'recorded_at'
    | 'notes'
  >
>;

export interface FoodDiaryEntryRow {
  id: Uuid;
  user_id: Uuid;
  episode_id: Uuid | null;
  meal_tag: MealTag;
  food_note: string;
  logged_at: IsoTimestamptz;
  created_at: IsoTimestamptz;
  updated_at: IsoTimestamptz;
}

export type FoodDiaryEntryInsert = Pick<
  FoodDiaryEntryRow,
  'user_id' | 'meal_tag' | 'food_note' | 'logged_at'
> & {
  id?: Uuid;
  episode_id?: Uuid | null;
};

export type FoodDiaryEntryUpdate = Partial<
  Pick<FoodDiaryEntryRow, 'episode_id' | 'meal_tag' | 'food_note' | 'logged_at'>
>;

export interface PractitionerAccessRow {
  id: Uuid;
  patient_user_id: Uuid;
  practitioner_user_id: Uuid;
  created_at: IsoTimestamptz;
  revoked_at: IsoTimestamptz | null;
}

export type PractitionerAccessInsert = Pick<
  PractitionerAccessRow,
  'patient_user_id' | 'practitioner_user_id'
> & {
  id?: Uuid;
  revoked_at?: IsoTimestamptz | null;
};

export type PractitionerAccessUpdate = Partial<
  Pick<PractitionerAccessRow, 'revoked_at'>
>;

export interface CaretakerAccessRow {
  id: Uuid;
  patient_user_id: Uuid;
  caretaker_user_id: Uuid;
  created_at: IsoTimestamptz;
  revoked_at: IsoTimestamptz | null;
}

export type CaretakerAccessInsert = Pick<
  CaretakerAccessRow,
  'patient_user_id' | 'caretaker_user_id'
> & {
  id?: Uuid;
  revoked_at?: IsoTimestamptz | null;
};

export type CaretakerAccessUpdate = Partial<
  Pick<CaretakerAccessRow, 'revoked_at'>
>;

export interface EpisodeMediaRow {
  id: Uuid;
  user_id: Uuid;
  episode_id: Uuid;
  episode_symptom_id: Uuid | null;
  storage_object_key: string;
  thumbnail_storage_key: string | null;
  media_type: MediaType;
  duration_seconds: number | null;
  upload_completed_at: IsoTimestamptz | null;
  created_at: IsoTimestamptz;
  updated_at: IsoTimestamptz;
}

export type EpisodeMediaInsert = Pick<
  EpisodeMediaRow,
  'user_id' | 'episode_id' | 'storage_object_key' | 'media_type'
> & {
  id?: Uuid;
  episode_symptom_id?: Uuid | null;
  thumbnail_storage_key?: string | null;
  duration_seconds?: number | null;
  upload_completed_at?: IsoTimestamptz | null;
};

export type EpisodeMediaUpdate = Partial<
  Pick<
    EpisodeMediaRow,
    | 'episode_symptom_id'
    | 'storage_object_key'
    | 'thumbnail_storage_key'
    | 'media_type'
    | 'duration_seconds'
    | 'upload_completed_at'
  >
>;

/** Append-only audit metadata; no PHI columns. */
export interface AccessLogRow {
  id: Uuid;
  occurred_at: IsoTimestamptz;
  actor_user_id: Uuid | null;
  actor_role: AccessLogActorRole;
  patient_user_id: Uuid | null;
  action: string;
  resource_type: string;
  resource_id: Uuid | null;
  request_id: string | null;
  ip_hash: string | null;
}

export type AccessLogInsert = Pick<
  AccessLogRow,
  'actor_role' | 'action' | 'resource_type'
> & {
  id?: Uuid;
  occurred_at?: IsoTimestamptz;
  actor_user_id?: Uuid | null;
  patient_user_id?: Uuid | null;
  resource_id?: Uuid | null;
  request_id?: string | null;
  ip_hash?: string | null;
};
