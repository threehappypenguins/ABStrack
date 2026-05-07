import { column, Schema, Table } from '@powersync/react-native';

const profiles = new Table(
  {
    display_name: column.text,
    app_role: column.text,
    created_at: column.text,
    updated_at: column.text,
  },
  { indexes: { profiles_app_role_idx: ['app_role'] } },
);

const symptom_presets = new Table(
  {
    user_id: column.text,
    name: column.text,
    created_at: column.text,
    updated_at: column.text,
  },
  { indexes: { symptom_presets_user_idx: ['user_id'] } },
);

const preset_symptoms = new Table(
  {
    preset_id: column.text,
    sort_order: column.integer,
    symptom_name: column.text,
    response_type: column.text,
    prompt_instruction: column.text,
    created_at: column.text,
    updated_at: column.text,
  },
  {
    indexes: {
      preset_symptoms_preset_idx: ['preset_id'],
      preset_symptoms_preset_sort_idx: ['preset_id', 'sort_order'],
    },
  },
);

const health_marker_presets = new Table(
  {
    user_id: column.text,
    name: column.text,
    created_at: column.text,
    updated_at: column.text,
  },
  { indexes: { health_marker_presets_user_idx: ['user_id'] } },
);

const preset_health_markers = new Table(
  {
    preset_id: column.text,
    sort_order: column.integer,
    marker_kind: column.text,
    custom_name: column.text,
    custom_unit: column.text,
    created_at: column.text,
    updated_at: column.text,
  },
  {
    indexes: {
      preset_health_markers_preset_idx: ['preset_id'],
      preset_health_markers_preset_sort_idx: ['preset_id', 'sort_order'],
    },
  },
);

const episode_templates = new Table(
  {
    user_id: column.text,
    name: column.text,
    symptom_preset_id: column.text,
    health_marker_preset_id: column.text,
    created_at: column.text,
    updated_at: column.text,
  },
  { indexes: { episode_templates_user_idx: ['user_id'] } },
);

const episodes = new Table(
  {
    user_id: column.text,
    symptom_preset_id: column.text,
    health_marker_preset_id: column.text,
    episode_type: column.text,
    episode_label: column.text,
    note: column.text,
    additional_notes: column.text,
    started_at: column.text,
    ended_at: column.text,
    post_marker_step_completed_at: column.text,
    created_at: column.text,
    updated_at: column.text,
  },
  {
    indexes: {
      episodes_user_started_idx: ['user_id', 'started_at'],
      episodes_user_type_idx: ['user_id', 'episode_type'],
    },
  },
);

const episode_symptoms = new Table(
  {
    user_id: column.text,
    episode_id: column.text,
    preset_symptom_id: column.text,
    symptom_name: column.text,
    response_type: column.text,
    response_boolean: column.integer,
    response_severity: column.integer,
    response_text: column.text,
    sort_order: column.integer,
    created_at: column.text,
    updated_at: column.text,
  },
  {
    indexes: {
      episode_symptoms_episode_idx: ['episode_id'],
      episode_symptoms_user_idx: ['user_id'],
      episode_symptoms_episode_sort_idx: ['episode_id', 'sort_order'],
    },
  },
);

const health_markers = new Table(
  {
    user_id: column.text,
    episode_id: column.text,
    preset_health_marker_id: column.text,
    marker_kind: column.text,
    custom_name: column.text,
    custom_unit: column.text,
    custom_name_key: column.text,
    custom_unit_key: column.text,
    value_numeric: column.real,
    systolic_numeric: column.real,
    diastolic_numeric: column.real,
    recorded_at: column.text,
    notes: column.text,
    created_at: column.text,
    updated_at: column.text,
  },
  {
    indexes: {
      health_markers_user_recorded_idx: ['user_id', 'recorded_at'],
      health_markers_episode_idx: ['episode_id'],
    },
  },
);

const food_diary_entries = new Table(
  {
    user_id: column.text,
    episode_id: column.text,
    meal_tag: column.text,
    food_note: column.text,
    logged_at: column.text,
    created_at: column.text,
    updated_at: column.text,
  },
  {
    indexes: {
      food_diary_user_logged_idx: ['user_id', 'logged_at'],
      food_diary_episode_idx: ['episode_id'],
    },
  },
);

const episode_media = new Table(
  {
    user_id: column.text,
    episode_id: column.text,
    episode_symptom_id: column.text,
    storage_object_key: column.text,
    thumbnail_storage_key: column.text,
    media_type: column.text,
    duration_seconds: column.integer,
    upload_completed_at: column.text,
    created_at: column.text,
    updated_at: column.text,
  },
  {
    indexes: {
      episode_media_episode_idx: ['episode_id'],
      episode_media_user_idx: ['user_id'],
      episode_media_symptom_step_idx: ['episode_symptom_id'],
    },
  },
);

const practitioner_access = new Table(
  {
    patient_user_id: column.text,
    practitioner_user_id: column.text,
    created_at: column.text,
    revoked_at: column.text,
  },
  {
    indexes: {
      practitioner_access_patient_idx: ['patient_user_id'],
      practitioner_access_practitioner_idx: ['practitioner_user_id'],
    },
  },
);

const caretaker_access = new Table(
  {
    patient_user_id: column.text,
    caretaker_user_id: column.text,
    created_at: column.text,
    revoked_at: column.text,
  },
  {
    // Postgres: caretaker_access_caretaker_idx + caretaker_access_one_active_per_patient_idx (patient_user_id).
    indexes: {
      caretaker_access_caretaker_idx: ['caretaker_user_id'],
      caretaker_access_one_active_per_patient_idx: ['patient_user_id'],
    },
  },
);

const access_log = new Table(
  {
    occurred_at: column.text,
    actor_user_id: column.text,
    actor_role: column.text,
    patient_user_id: column.text,
    action: column.text,
    resource_type: column.text,
    resource_id: column.text,
    request_id: column.text,
    ip_hash: column.text,
  },
  {
    indexes: {
      access_log_patient_time_idx: ['patient_user_id', 'occurred_at'],
      access_log_actor_time_idx: ['actor_user_id', 'occurred_at'],
      access_log_resource_idx: ['resource_type', 'resource_id'],
    },
  },
);

/**
 * Local-only queue for offline captured episode media: encrypted files on disk plus linkage metadata.
 * Not replicated to Postgres (`localOnly`). The worker uploads via Supabase Storage when online.
 */
const pending_episode_media_upload = new Table(
  {
    id: column.text,
    user_id: column.text,
    episode_id: column.text,
    episode_symptom_id: column.text,
    preset_symptom_id: column.text,
    /** `episodes.post_marker_step_completed_at` snapshot for supersede cleanup on upload. */
    last_post_marker_step_completed_at: column.text,
    media_type: column.text,
    content_type_primary: column.text,
    extension: column.text,
    duration_seconds: column.integer,
    /** Relative path segments from app documents root to ciphertext primary media file. */
    primary_cipher_relative_path: column.text,
    thumbnail_cipher_relative_path: column.text,
    attempt_count: column.integer,
    last_attempt_at: column.text,
    last_error: column.text,
    created_at: column.text,
    updated_at: column.text,
  },
  {
    localOnly: true,
    indexes: {
      pending_media_episode_idx: ['episode_id'],
      pending_media_symptom_idx: ['episode_symptom_id'],
    },
  },
);

/**
 * Client-side PowerSync schema aligned with Supabase `public` PHI tables listed in
 * `packages/powersync/sync-rules.yaml`.
 *
 * Defined next to `PowerSyncDatabase` wiring so `Schema` / `Table` come from `@powersync/react-native`
 * (same export surface as the SDK) — avoids nominal type clashes with a workspace-built schema.
 *
 * SQLite stores Postgres `uuid` and `timestamptz` fields as text; numeric columns as REAL;
 * booleans as INTEGER (0/1).
 */
export const abstrackPowerSyncSchema = new Schema({
  profiles,
  symptom_presets,
  preset_symptoms,
  health_marker_presets,
  preset_health_markers,
  episode_templates,
  episodes,
  episode_symptoms,
  health_markers,
  food_diary_entries,
  episode_media,
  practitioner_access,
  caretaker_access,
  access_log,
  pending_episode_media_upload,
});

export type AbstrackPowerSyncDatabase =
  (typeof abstrackPowerSyncSchema)['types'];
