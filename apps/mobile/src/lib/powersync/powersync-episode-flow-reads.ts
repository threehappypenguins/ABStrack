import type { EpisodeMediaListRow } from '@abstrack/supabase';
import type {
  EpisodeRow,
  EpisodeSymptomRow,
  EpisodeTemplateWithPresetsRow,
  HealthMarkerPresetRow,
  HealthMarkerRow,
  PresetHealthMarkerRow,
  PresetSymptomRow,
  SymptomPresetRow,
} from '@abstrack/types';
import {
  isHealthMarkerKind,
  isPresetHealthMarkerKind,
  isSymptomResponseType,
} from '@abstrack/types';
import type { PowerSyncDatabase } from '@powersync/react-native';

import {
  EPISODE_COLUMNS,
  mapSqliteRowToEpisodeRow,
} from './episode-powersync-read';

function requiredText(value: unknown): string | null {
  const s = value != null ? String(value).trim() : '';
  return s.length > 0 ? s : null;
}

function optionalText(value: unknown): string | null {
  const s = requiredText(value);
  return s;
}

function mapSqlIntToBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const n = Number(value);
  if (n === 1) {
    return true;
  }
  if (n === 0) {
    return false;
  }
  return null;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Loads one episode row from the local PowerSync replica.
 *
 * @param db - Open encrypted {@link PowerSyncDatabase}.
 * @param episodeId - `episodes.id`.
 * @returns Mapped {@link EpisodeRow}, or `null` when missing or invalid.
 */
export async function getEpisodeByIdFromPowerSyncDb(
  db: PowerSyncDatabase,
  episodeId: string,
): Promise<EpisodeRow | null> {
  const sql = `
SELECT ${EPISODE_COLUMNS}
FROM episodes
WHERE id = ?
LIMIT 1
`.trim();
  const row = await db.getOptional(sql, [episodeId]);
  if (!row || typeof row !== 'object') {
    return null;
  }
  return mapSqliteRowToEpisodeRow(row as Record<string, unknown>);
}

/**
 * Maps a `preset_symptoms` SQLite row to {@link PresetSymptomRow}.
 *
 * @param row - Raw row from PowerSync.
 * @returns Typed row, or `null` when required fields are invalid.
 */
export function mapSqliteRowToPresetSymptomRow(
  row: Record<string, unknown>,
): PresetSymptomRow | null {
  const id = requiredText(row.id);
  const preset_id = requiredText(row.preset_id);
  const symptom_name = requiredText(row.symptom_name);
  const created_at = requiredText(row.created_at);
  const updated_at = requiredText(row.updated_at);
  const response_type = row.response_type;
  if (
    !id ||
    !preset_id ||
    !symptom_name ||
    !created_at ||
    !updated_at ||
    !isSymptomResponseType(response_type)
  ) {
    return null;
  }
  const sort_order = Number(row.sort_order);
  if (!Number.isFinite(sort_order)) {
    return null;
  }
  return {
    id,
    preset_id,
    sort_order,
    symptom_name,
    response_type,
    prompt_instruction: optionalText(row.prompt_instruction),
    created_at,
    updated_at,
  };
}

/**
 * Lists preset symptom lines for one preset from the local replica (same ordering as Supabase).
 *
 * @param db - Open PowerSync database.
 * @param presetId - `symptom_presets.id`.
 */
export async function listPresetSymptomsForPresetFromPowerSyncDb(
  db: PowerSyncDatabase,
  presetId: string,
): Promise<PresetSymptomRow[]> {
  const sql = `
SELECT id, preset_id, sort_order, symptom_name, response_type, prompt_instruction, created_at, updated_at
FROM preset_symptoms
WHERE preset_id = ?
ORDER BY sort_order ASC, id ASC
`.trim();
  const rows = await db.getAll(sql, [presetId]);
  const out: PresetSymptomRow[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const mapped = mapSqliteRowToPresetSymptomRow(
      raw as Record<string, unknown>,
    );
    if (mapped) {
      out.push(mapped);
    }
  }
  return out;
}

/**
 * Maps an `episode_symptoms` SQLite row to {@link EpisodeSymptomRow}.
 *
 * @param row - Raw row from PowerSync.
 * @returns Typed row, or `null` when required fields are invalid.
 */
export function mapSqliteRowToEpisodeSymptomRow(
  row: Record<string, unknown>,
): EpisodeSymptomRow | null {
  const id = requiredText(row.id);
  const user_id = requiredText(row.user_id);
  const symptom_name = requiredText(row.symptom_name);
  const created_at = requiredText(row.created_at);
  const updated_at = requiredText(row.updated_at);
  const response_type = row.response_type;
  if (
    !id ||
    !user_id ||
    !symptom_name ||
    !created_at ||
    !updated_at ||
    !isSymptomResponseType(response_type)
  ) {
    return null;
  }
  const sort_order = Number(row.sort_order);
  if (!Number.isFinite(sort_order)) {
    return null;
  }
  return {
    id,
    user_id,
    episode_id: optionalText(row.episode_id),
    preset_symptom_id: optionalText(row.preset_symptom_id),
    symptom_name,
    response_type,
    response_boolean: mapSqlIntToBoolean(row.response_boolean),
    response_severity: optionalNumber(row.response_severity),
    response_text: optionalText(row.response_text),
    sort_order,
    created_at,
    updated_at,
  };
}

/**
 * Lists episode symptom answers for one episode from the local replica.
 *
 * @param db - Open PowerSync database.
 * @param episodeId - `episodes.id`.
 * @param orderBy - `recent` matches Supabase `listEpisodeSymptomsForEpisode` when `orderBy: 'recent'`.
 */
export async function listEpisodeSymptomsForEpisodeFromPowerSyncDb(
  db: PowerSyncDatabase,
  episodeId: string,
  orderBy: 'preset' | 'recent',
): Promise<EpisodeSymptomRow[]> {
  const orderClause =
    orderBy === 'recent'
      ? 'ORDER BY created_at DESC, id DESC'
      : 'ORDER BY sort_order ASC, created_at DESC, id DESC';
  const sql = `
SELECT id, user_id, episode_id, preset_symptom_id, symptom_name, response_type,
  response_boolean, response_severity, response_text, sort_order, created_at, updated_at
FROM episode_symptoms
WHERE episode_id = ?
${orderClause}
`.trim();
  const rows = await db.getAll(sql, [episodeId]);
  const out: EpisodeSymptomRow[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const mapped = mapSqliteRowToEpisodeSymptomRow(
      raw as Record<string, unknown>,
    );
    if (mapped) {
      out.push(mapped);
    }
  }
  return out;
}

/**
 * Maps a `preset_health_markers` SQLite row to {@link PresetHealthMarkerRow}.
 *
 * @param row - Raw row from PowerSync.
 * @returns Typed row, or `null` when required fields are invalid.
 */
export function mapSqliteRowToPresetHealthMarkerRow(
  row: Record<string, unknown>,
): PresetHealthMarkerRow | null {
  const id = requiredText(row.id);
  const preset_id = requiredText(row.preset_id);
  const created_at = requiredText(row.created_at);
  const updated_at = requiredText(row.updated_at);
  const marker_kind = row.marker_kind;
  if (
    !id ||
    !preset_id ||
    !created_at ||
    !updated_at ||
    !isPresetHealthMarkerKind(marker_kind)
  ) {
    return null;
  }
  const sort_order = Number(row.sort_order);
  if (!Number.isFinite(sort_order)) {
    return null;
  }
  return {
    id,
    preset_id,
    sort_order,
    marker_kind,
    custom_name: optionalText(row.custom_name),
    custom_unit: optionalText(row.custom_unit),
    created_at,
    updated_at,
  };
}

/**
 * Lists preset health marker lines for one preset from the local replica.
 *
 * @param db - Open PowerSync database.
 * @param presetId - `health_marker_presets.id`.
 */
export async function listPresetHealthMarkersForPresetFromPowerSyncDb(
  db: PowerSyncDatabase,
  presetId: string,
): Promise<PresetHealthMarkerRow[]> {
  const sql = `
SELECT id, preset_id, sort_order, marker_kind, custom_name, custom_unit, created_at, updated_at
FROM preset_health_markers
WHERE preset_id = ?
ORDER BY sort_order ASC, id ASC
`.trim();
  const rows = await db.getAll(sql, [presetId]);
  const out: PresetHealthMarkerRow[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const mapped = mapSqliteRowToPresetHealthMarkerRow(
      raw as Record<string, unknown>,
    );
    if (mapped) {
      out.push(mapped);
    }
  }
  return out;
}

/**
 * Maps a `health_markers` SQLite row to {@link HealthMarkerRow}.
 *
 * @param row - Raw row from PowerSync.
 * @returns Typed row, or `null` when required fields are invalid.
 */
export function mapSqliteRowToHealthMarkerRow(
  row: Record<string, unknown>,
): HealthMarkerRow | null {
  const id = requiredText(row.id);
  const user_id = requiredText(row.user_id);
  const recorded_at = requiredText(row.recorded_at);
  const created_at = requiredText(row.created_at);
  const updated_at = requiredText(row.updated_at);
  const marker_kind = row.marker_kind;
  if (
    !id ||
    !user_id ||
    !recorded_at ||
    !created_at ||
    !updated_at ||
    !isHealthMarkerKind(marker_kind)
  ) {
    return null;
  }
  return {
    id,
    user_id,
    episode_id: optionalText(row.episode_id),
    preset_health_marker_id: optionalText(row.preset_health_marker_id),
    marker_kind,
    custom_name: optionalText(row.custom_name),
    custom_name_key: optionalText(row.custom_name_key),
    custom_unit: optionalText(row.custom_unit),
    custom_unit_key: optionalText(row.custom_unit_key),
    value_numeric: optionalNumber(row.value_numeric),
    systolic_numeric: optionalNumber(row.systolic_numeric),
    diastolic_numeric: optionalNumber(row.diastolic_numeric),
    recorded_at,
    notes: optionalText(row.notes),
    created_at,
    updated_at,
  };
}

/**
 * Lists health marker measurements for one episode from the local replica (newest first).
 *
 * Ordering matches `listEpisodeHealthMarkersForEpisode` in `@abstrack/supabase` (`recorded_at`
 * descending, then `id` descending) so REST and offline-first reads agree when `recorded_at` ties
 * under a `LIMIT` (no `created_at` tie-break).
 *
 * @param db - Open PowerSync database.
 * @param episodeId - `episodes.id`.
 * @param limit - Optional cap (same semantics as Supabase helper).
 */
export async function listEpisodeHealthMarkersForEpisodeFromPowerSyncDb(
  db: PowerSyncDatabase,
  episodeId: string,
  limit?: number,
): Promise<HealthMarkerRow[]> {
  const lim =
    limit != null && Number.isFinite(limit)
      ? Math.max(0, Math.trunc(limit))
      : null;
  const sql = `
SELECT id, user_id, episode_id, preset_health_marker_id, marker_kind, custom_name, custom_unit,
  custom_name_key, custom_unit_key, value_numeric, systolic_numeric, diastolic_numeric,
  recorded_at, notes, created_at, updated_at
FROM health_markers
WHERE episode_id = ?
ORDER BY recorded_at DESC, id DESC
${lim != null ? `LIMIT ${lim}` : ''}
`.trim();
  const rows = await db.getAll(sql, [episodeId]);
  const out: HealthMarkerRow[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const mapped = mapSqliteRowToHealthMarkerRow(
      raw as Record<string, unknown>,
    );
    if (mapped) {
      out.push(mapped);
    }
  }
  return out;
}

/**
 * Mobile app scope is **patient and caretaker only** (no practitioner mobile). Rows whose `user_id`
 * is the signed-in user or a patient linked via non-revoked caretaker grant. Two placeholders,
 * both bound to the signed-in auth user id.
 */
const PHI_ROW_USER_ID_VISIBLE_TO_AUTH_SQL = `
(
  user_id = ?
  OR user_id IN (
    SELECT ca.patient_user_id FROM caretaker_access ca
    WHERE ca.caretaker_user_id = ?
      AND (ca.revoked_at IS NULL OR ca.revoked_at = '')
  )
)
`.trim();

function mapSqliteRowToSymptomPresetRow(
  row: Record<string, unknown>,
): SymptomPresetRow | null {
  const id = requiredText(row.id);
  const user_id = requiredText(row.user_id);
  const name = requiredText(row.name);
  const created_at = requiredText(row.created_at);
  const updated_at = requiredText(row.updated_at);
  if (!id || !user_id || !name || !created_at || !updated_at) {
    return null;
  }
  return { id, user_id, name, created_at, updated_at };
}

/**
 * Lists symptom presets visible to the signed-in patient or caretaker from the local replica.
 *
 * @param db - Open PowerSync database.
 * @param authUserId - Signed-in Supabase auth user id.
 */
export async function listSymptomPresetsForUserFromPowerSyncDb(
  db: PowerSyncDatabase,
  authUserId: string,
): Promise<SymptomPresetRow[]> {
  const sql = `
SELECT id, user_id, name, created_at, updated_at
FROM symptom_presets
WHERE ${PHI_ROW_USER_ID_VISIBLE_TO_AUTH_SQL}
ORDER BY created_at ASC, id ASC
`.trim();
  const rows = await db.getAll(sql, [authUserId, authUserId]);
  const out: SymptomPresetRow[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const mapped = mapSqliteRowToSymptomPresetRow(
      raw as Record<string, unknown>,
    );
    if (mapped) {
      out.push(mapped);
    }
  }
  return out;
}

function mapSqliteRowToHealthMarkerPresetRow(
  row: Record<string, unknown>,
): HealthMarkerPresetRow | null {
  const id = requiredText(row.id);
  const user_id = requiredText(row.user_id);
  const name = requiredText(row.name);
  const created_at = requiredText(row.created_at);
  const updated_at = requiredText(row.updated_at);
  if (!id || !user_id || !name || !created_at || !updated_at) {
    return null;
  }
  return { id, user_id, name, created_at, updated_at };
}

/**
 * Lists health marker presets visible to the signed-in patient or caretaker from the local replica.
 *
 * @param db - Open PowerSync database.
 * @param authUserId - Signed-in Supabase auth user id.
 */
export async function listHealthMarkerPresetsForUserFromPowerSyncDb(
  db: PowerSyncDatabase,
  authUserId: string,
): Promise<HealthMarkerPresetRow[]> {
  const sql = `
SELECT id, user_id, name, created_at, updated_at
FROM health_marker_presets
WHERE ${PHI_ROW_USER_ID_VISIBLE_TO_AUTH_SQL}
ORDER BY created_at ASC, id ASC
`.trim();
  const rows = await db.getAll(sql, [authUserId, authUserId]);
  const out: HealthMarkerPresetRow[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const mapped = mapSqliteRowToHealthMarkerPresetRow(
      raw as Record<string, unknown>,
    );
    if (mapped) {
      out.push(mapped);
    }
  }
  return out;
}

function mapSqliteRowToEpisodeTemplateWithPresetsRow(
  raw: Record<string, unknown>,
): EpisodeTemplateWithPresetsRow | null {
  const id = requiredText(raw.id);
  const rowUserId = requiredText(raw.user_id);
  const name = requiredText(raw.name);
  const symptom_preset_id = requiredText(raw.symptom_preset_id);
  const health_marker_preset_id = requiredText(raw.health_marker_preset_id);
  const created_at = requiredText(raw.created_at);
  const updated_at = requiredText(raw.updated_at);
  const symptom_preset_name = requiredText(raw.symptom_preset_name);
  const health_marker_preset_name = requiredText(raw.health_marker_preset_name);
  if (
    !id ||
    !rowUserId ||
    !name ||
    !symptom_preset_id ||
    !health_marker_preset_id ||
    !created_at ||
    !updated_at ||
    !symptom_preset_name ||
    !health_marker_preset_name
  ) {
    return null;
  }
  return {
    id,
    user_id: rowUserId,
    name,
    symptom_preset_id,
    health_marker_preset_id,
    created_at,
    updated_at,
    symptom_preset: { id: symptom_preset_id, name: symptom_preset_name },
    health_marker_preset: {
      id: health_marker_preset_id,
      name: health_marker_preset_name,
    },
  };
}

const EPISODE_TEMPLATE_WITH_PRESETS_SQL = `
SELECT
  et.id,
  et.user_id,
  et.name,
  et.symptom_preset_id,
  et.health_marker_preset_id,
  et.created_at,
  et.updated_at,
  sp.name AS symptom_preset_name,
  hmp.name AS health_marker_preset_name
FROM episode_templates et
INNER JOIN symptom_presets sp ON sp.id = et.symptom_preset_id
INNER JOIN health_marker_presets hmp ON hmp.id = et.health_marker_preset_id
`.trim();

/**
 * Patient/caretaker mobile scope only: own template rows or templates for a patient linked via
 * active `caretaker_access`. Two placeholders, both the signed-in auth user id.
 */
const EPISODE_TEMPLATE_VISIBLE_TO_AUTH_SQL = `
(
  et.user_id = ?
  OR et.user_id IN (
    SELECT ca.patient_user_id FROM caretaker_access ca
    WHERE ca.caretaker_user_id = ?
      AND (ca.revoked_at IS NULL OR ca.revoked_at = '')
  )
)
`.trim();

/**
 * Lists episode templates with nested preset names from the local replica (same ordering as Supabase).
 *
 * @param db - Open PowerSync database.
 * @param authUserId - Signed-in Supabase auth user id (patient or caretaker); not practitioner—
 *   the mobile app does not serve practitioners.
 */
export async function listEpisodeTemplatesWithPresetsFromPowerSyncDb(
  db: PowerSyncDatabase,
  authUserId: string,
): Promise<EpisodeTemplateWithPresetsRow[]> {
  const sql = `
${EPISODE_TEMPLATE_WITH_PRESETS_SQL}
WHERE ${EPISODE_TEMPLATE_VISIBLE_TO_AUTH_SQL}
ORDER BY et.created_at ASC, et.id ASC
`.trim();
  const rows = await db.getAll(sql, [authUserId, authUserId]);
  const out: EpisodeTemplateWithPresetsRow[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const mapped = mapSqliteRowToEpisodeTemplateWithPresetsRow(
      raw as Record<string, unknown>,
    );
    if (mapped) {
      out.push(mapped);
    }
  }
  return out;
}

/**
 * Loads one episode template visible to the signed-in user (same rules as
 * {@link listEpisodeTemplatesWithPresetsFromPowerSyncDb}).
 *
 * @param db - Open PowerSync database.
 * @param templateId - `episode_templates.id`.
 * @param authUserId - Signed-in Supabase auth user id.
 */
export async function getEpisodeTemplateWithPresetsByIdFromPowerSyncDb(
  db: PowerSyncDatabase,
  templateId: string,
  authUserId: string,
): Promise<EpisodeTemplateWithPresetsRow | null> {
  const sql = `
${EPISODE_TEMPLATE_WITH_PRESETS_SQL}
WHERE et.id = ? AND ${EPISODE_TEMPLATE_VISIBLE_TO_AUTH_SQL}
LIMIT 1
`.trim();
  const raw = await db.getOptional(sql, [templateId, authUserId, authUserId]);
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  return mapSqliteRowToEpisodeTemplateWithPresetsRow(
    raw as Record<string, unknown>,
  );
}

/**
 * Lists narrow `episode_media` rows for symptom prompt hydration from the local replica.
 *
 * @param db - Open PowerSync database.
 * @param episodeId - `episodes.id`.
 * @param episodeSymptomIds - When non-empty, filters to these `episode_symptoms.id` values.
 */
export async function listEpisodeMediaForEpisodeFromPowerSyncDb(
  db: PowerSyncDatabase,
  episodeId: string,
  episodeSymptomIds?: string[],
): Promise<EpisodeMediaListRow[]> {
  if (episodeSymptomIds !== undefined && episodeSymptomIds.length === 0) {
    return [];
  }
  let sql = `
SELECT episode_symptom_id, storage_object_key, thumbnail_storage_key, media_type, upload_completed_at, duration_seconds
FROM episode_media
WHERE episode_id = ?
`.trim();
  const params: string[] = [episodeId];
  if (episodeSymptomIds !== undefined && episodeSymptomIds.length > 0) {
    const ph = episodeSymptomIds.map(() => '?').join(', ');
    sql += ` AND episode_symptom_id IN (${ph})`;
    params.push(...episodeSymptomIds);
  }
  sql += '\nORDER BY created_at DESC, id DESC';
  const rows = await db.getAll(sql, params);
  const out: EpisodeMediaListRow[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const m = raw as Record<string, unknown>;
    const episode_symptom_id = optionalText(m.episode_symptom_id);
    const storage_object_key = requiredText(m.storage_object_key);
    if (!episode_symptom_id || !storage_object_key) {
      continue;
    }
    const media_type = requiredText(m.media_type);
    if (media_type !== 'photo' && media_type !== 'video') {
      continue;
    }
    out.push({
      episode_symptom_id,
      storage_object_key,
      thumbnail_storage_key: optionalText(m.thumbnail_storage_key),
      media_type,
      upload_completed_at: optionalText(m.upload_completed_at),
      duration_seconds: optionalNumber(m.duration_seconds),
    });
  }
  return out;
}
