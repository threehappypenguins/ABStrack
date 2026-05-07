/**
 * Offline-first writes against the encrypted PowerSync SQLite replica. Mutations queue for upload;
 * {@link uploadPowerSyncCrudBatchToSupabase} applies them to Supabase when online (checkpointing
 * each op after success).
 */
import type {
  EpisodeRow,
  EpisodeSymptomRow,
  FoodDiaryEntryInsert,
  FoodDiaryEntryRow,
  FoodDiaryEntryUpdate,
  HealthMarkerRow,
  IsoTimestamptz,
  PresetHealthMarkerRow,
  PresetSymptomRow,
  SymptomPromptAnswer,
  Uuid,
} from '@abstrack/types';
import {
  isMealTag,
  symptomPromptAnswerToResponseColumns,
  validatePresetHealthMarkerCustomFields,
} from '@abstrack/types';
import type {
  CancelActiveEpisodeByIdResult,
  DeleteEpisodeByIdResult,
  EpisodePostMarkerStepWrite,
  PresetDataResult,
} from '@abstrack/supabase';
import {
  PresetDataError,
  buildHealthMarkerInsertRowForPresetLine,
  validateHealthMarkerNumericPayload,
} from '@abstrack/supabase';
import type { PowerSyncDatabase } from '@powersync/react-native';

import {
  EPISODE_COLUMNS,
  mapSqliteRowToEpisodeRow,
} from './episode-powersync-read';
import {
  mapSqliteRowToEpisodeSymptomRow,
  mapSqliteRowToHealthMarkerRow,
} from './powersync-episode-flow-reads';

/**
 * UUID v4 for local PowerSync rows. React Native usually has `getRandomValues` (via
 * `react-native-get-random-values` in app entry `apps/mobile/index.js`) but not always `randomUUID`.
 */
function newLocalUuid(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') {
    return c.randomUUID();
  }
  if (typeof c?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
      '',
    );
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error(
    'Neither crypto.randomUUID nor crypto.getRandomValues is available; ensure react-native-get-random-values is imported at app entry.',
  );
}

function trimCustomField(value: string | null | undefined): string | null {
  const next = value?.trim() ?? '';
  return next.length > 0 ? next : null;
}

function computeSafeEndedAtIso(
  startedAt: string | undefined,
  endedAt: string,
): string {
  const startedAtMs =
    typeof startedAt === 'string' ? Date.parse(startedAt) : Number.NaN;
  const endedAtMs = Date.parse(endedAt);
  if (
    typeof startedAt === 'string' &&
    Number.isFinite(startedAtMs) &&
    Number.isFinite(endedAtMs) &&
    endedAtMs < startedAtMs
  ) {
    return startedAt;
  }
  return endedAt;
}

/**
 * Inserts a new `episodes` row locally (queues PUT for Supabase upload).
 *
 * @param db - Initialized PowerSync database.
 * @param args - Episode identity and preset linkage (same intent as Supabase {@link createEpisode}).
 */
export async function insertEpisodeRowIntoPowerSync(
  db: PowerSyncDatabase,
  args: {
    id: Uuid;
    userId: Uuid;
    symptomPresetId: Uuid;
    healthMarkerPresetId: Uuid;
    startedAt: IsoTimestamptz;
    episodeType?: 'ABS' | 'Other';
  },
): Promise<PresetDataResult<EpisodeRow>> {
  const episodeType = args.episodeType ?? 'Other';
  const now = new Date().toISOString();
  try {
    await db.execute(
      `INSERT INTO episodes (id, user_id, symptom_preset_id, health_marker_preset_id, episode_type, episode_label, note, additional_notes, started_at, ended_at, post_marker_step_completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, ?, ?)`,
      [
        args.id,
        args.userId,
        args.symptomPresetId,
        args.healthMarkerPresetId,
        episodeType,
        args.startedAt,
        now,
        now,
      ],
    );
    const raw = await db.getOptional<Record<string, unknown>>(
      `SELECT ${EPISODE_COLUMNS} FROM episodes WHERE id = ?`,
      [args.id],
    );
    const mapped = raw ? mapSqliteRowToEpisodeRow(raw) : null;
    if (!mapped) {
      return {
        ok: false,
        error: new PresetDataError(
          'unknown',
          'Could not read the episode after saving locally.',
        ),
      };
    }
    return { ok: true, data: mapped };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: new PresetDataError('unknown', message, e),
    };
  }
}

/**
 * Creates {@link insertEpisodeRowIntoPowerSync} args with a fresh id (shared helper for callers).
 *
 * @param args - Episode fields without `id`.
 */
export function buildNewEpisodePowerSyncInsertArgs(args: {
  userId: Uuid;
  symptomPresetId: Uuid;
  healthMarkerPresetId: Uuid;
  startedAt: IsoTimestamptz;
  episodeType?: 'ABS' | 'Other';
}): {
  id: Uuid;
  userId: Uuid;
  symptomPresetId: Uuid;
  healthMarkerPresetId: Uuid;
  startedAt: IsoTimestamptz;
  episodeType?: 'ABS' | 'Other';
} {
  return { ...args, id: newLocalUuid() };
}

/**
 * Inserts one `episode_symptoms` answer row locally.
 *
 * @param db - Initialized PowerSync database.
 * @param args - Same shape as {@link insertEpisodeSymptomAnswer} (without Supabase client).
 */
export async function insertEpisodeSymptomAnswerIntoPowerSyncDb(
  db: PowerSyncDatabase,
  args: {
    userId: Uuid;
    episodeId: Uuid;
    line: PresetSymptomRow;
    answer: SymptomPromptAnswer;
  },
): Promise<PresetDataResult<EpisodeSymptomRow>> {
  const { userId, episodeId, line, answer } = args;
  if (answer.type !== line.response_type) {
    return {
      ok: false,
      error: new PresetDataError(
        'validation_error',
        'Answer type does not match this symptom line.',
      ),
    };
  }
  const response = symptomPromptAnswerToResponseColumns(answer);
  const id = newLocalUuid();
  const now = new Date().toISOString();
  const rb = response.response_boolean;
  const ri = rb === null || rb === undefined ? null : rb ? 1 : 0;
  try {
    await db.execute(
      `INSERT INTO episode_symptoms (id, user_id, episode_id, preset_symptom_id, symptom_name, response_type, response_boolean, response_severity, response_text, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        episodeId,
        line.id,
        line.symptom_name,
        response.response_type,
        ri,
        response.response_severity,
        response.response_text,
        line.sort_order,
        now,
        now,
      ],
    );
    const raw = await db.getOptional<Record<string, unknown>>(
      `SELECT * FROM episode_symptoms WHERE id = ?`,
      [id],
    );
    const mapped = raw ? mapSqliteRowToEpisodeSymptomRow(raw) : null;
    if (!mapped) {
      return {
        ok: false,
        error: new PresetDataError(
          'unknown',
          'Could not read the symptom answer after saving locally.',
        ),
      };
    }
    return { ok: true, data: mapped };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: new PresetDataError('unknown', message, e),
    };
  }
}

/**
 * Inserts one episode-bound `health_markers` row locally after the same validation as REST insert.
 *
 * @param db - Initialized PowerSync database.
 * @param args - Same fields as {@link insertEpisodeHealthMarkerForLine} (without Supabase client).
 */
export async function insertEpisodeHealthMarkerLineIntoPowerSyncDb(
  db: PowerSyncDatabase,
  args: {
    userId: Uuid;
    episodeId: Uuid;
    line: PresetHealthMarkerRow;
    valueNumeric?: number | null;
    systolicNumeric?: number | null;
    diastolicNumeric?: number | null;
    notes?: string | null;
    recordedAt?: string;
  },
): Promise<PresetDataResult<HealthMarkerRow>> {
  const {
    userId,
    episodeId,
    line,
    valueNumeric = null,
    systolicNumeric = null,
    diastolicNumeric = null,
    notes = null,
    recordedAt = new Date().toISOString(),
  } = args;

  const customName = trimCustomField(line.custom_name);
  const customUnit = trimCustomField(line.custom_unit);
  const customValidation = validatePresetHealthMarkerCustomFields(
    line.marker_kind,
    customName ?? '',
    customUnit ?? '',
  );
  if (customValidation) {
    return {
      ok: false,
      error: new PresetDataError('validation_error', customValidation),
    };
  }
  const numericValidation = validateHealthMarkerNumericPayload(
    line.marker_kind,
    valueNumeric,
    systolicNumeric,
    diastolicNumeric,
  );
  if (numericValidation) {
    return {
      ok: false,
      error: new PresetDataError('validation_error', numericValidation),
    };
  }

  const insert = buildHealthMarkerInsertRowForPresetLine({
    userId,
    episodeId,
    line,
    customName,
    customUnit,
    valueNumeric,
    systolicNumeric,
    diastolicNumeric,
    notes,
    recordedAt,
  });

  const id = newLocalUuid();
  const now = new Date().toISOString();
  try {
    await db.execute(
      `INSERT INTO health_markers (id, user_id, episode_id, preset_health_marker_id, marker_kind, custom_name, custom_unit, value_numeric, systolic_numeric, diastolic_numeric, recorded_at, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        insert.user_id,
        insert.episode_id,
        insert.preset_health_marker_id,
        insert.marker_kind,
        insert.custom_name,
        insert.custom_unit,
        insert.value_numeric,
        insert.systolic_numeric,
        insert.diastolic_numeric,
        insert.recorded_at,
        insert.notes,
        now,
        now,
      ],
    );
    const raw = await db.getOptional<Record<string, unknown>>(
      `SELECT * FROM health_markers WHERE id = ?`,
      [id],
    );
    const mapped = raw ? mapSqliteRowToHealthMarkerRow(raw) : null;
    if (!mapped) {
      return {
        ok: false,
        error: new PresetDataError(
          'unknown',
          'Could not read the health marker after saving locally.',
        ),
      };
    }
    return { ok: true, data: mapped };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: new PresetDataError('unknown', message, e),
    };
  }
}

/**
 * Updates episode post-marker fields locally for rows that are still active (`ended_at IS NULL`).
 *
 * @param db - Initialized PowerSync database.
 * @param episodeId - Episode id.
 * @param fields - Same payload as {@link completeEpisodePostMarkerStep}.
 */
export async function completeEpisodePostMarkerStepPowerSyncDb(
  db: PowerSyncDatabase,
  episodeId: Uuid,
  fields: EpisodePostMarkerStepWrite,
): Promise<PresetDataResult<EpisodeRow>> {
  const completedAt =
    fields.post_marker_step_completed_at ?? new Date().toISOString();
  const now = new Date().toISOString();
  try {
    const active = await db.getOptional<{ id: string }>(
      `SELECT id FROM episodes WHERE id = ? AND ended_at IS NULL`,
      [episodeId],
    );
    if (!active) {
      return {
        ok: false,
        error: new PresetDataError(
          'not_found',
          'Could not save episode details. This episode may be missing, already ended, or no longer available.',
        ),
      };
    }
    await db.execute(
      `UPDATE episodes SET additional_notes = ?, episode_label = ?, episode_type = ?, note = ?, post_marker_step_completed_at = ?, updated_at = ?
       WHERE id = ? AND ended_at IS NULL`,
      [
        fields.additional_notes,
        fields.episode_label,
        fields.episode_type,
        fields.note,
        completedAt,
        now,
        episodeId,
      ],
    );
    const raw = await db.getOptional<Record<string, unknown>>(
      `SELECT ${EPISODE_COLUMNS} FROM episodes WHERE id = ?`,
      [episodeId],
    );
    const mapped = raw ? mapSqliteRowToEpisodeRow(raw) : null;
    if (!mapped) {
      return {
        ok: false,
        error: new PresetDataError(
          'not_found',
          'Could not save episode details. This episode may be missing, already ended, or no longer available.',
        ),
      };
    }
    return { ok: true, data: mapped };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: new PresetDataError('unknown', message, e),
    };
  }
}

/**
 * Ends an active episode locally (`ended_at` set if still null).
 *
 * @param db - Initialized PowerSync database.
 * @param episodeId - Episode id.
 * @param endedAt - Requested end time (defaults to now).
 * @param startedAt - Episode `started_at` for clamping when clocks skew (optional).
 */
export async function endEpisodeIfStillActivePowerSyncDb(
  db: PowerSyncDatabase,
  episodeId: Uuid,
  endedAt: string = new Date().toISOString(),
  startedAt?: string,
): Promise<PresetDataResult<{ didEnd: boolean }>> {
  const safeEndedAt = computeSafeEndedAtIso(startedAt, endedAt);
  const now = new Date().toISOString();
  try {
    const prior = await db.getOptional<{ ended_at: unknown }>(
      `SELECT ended_at FROM episodes WHERE id = ?`,
      [episodeId],
    );
    if (!prior || prior.ended_at != null) {
      return { ok: true, data: { didEnd: false } };
    }
    await db.execute(
      `UPDATE episodes SET ended_at = ?, updated_at = ? WHERE id = ? AND ended_at IS NULL`,
      [safeEndedAt, now, episodeId],
    );
    return { ok: true, data: { didEnd: true } };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: new PresetDataError('unknown', message, e),
    };
  }
}

function mapSqliteRowToFoodDiaryEntryRow(
  row: Record<string, unknown>,
): FoodDiaryEntryRow | null {
  const id = String(row.id ?? '').trim();
  const user_id = String(row.user_id ?? '').trim();
  const meal_tag = row.meal_tag;
  const food_note = String(row.food_note ?? '').trim();
  const logged_at = String(row.logged_at ?? '').trim();
  const created_at = String(row.created_at ?? '').trim();
  const updated_at = String(row.updated_at ?? '').trim();
  const episode_id_raw = row.episode_id;
  const episode_id =
    episode_id_raw == null || episode_id_raw === ''
      ? null
      : String(episode_id_raw).trim();
  if (
    !id ||
    !user_id ||
    !isMealTag(meal_tag) ||
    !food_note ||
    !logged_at ||
    !created_at ||
    !updated_at
  ) {
    return null;
  }
  return {
    id,
    user_id,
    episode_id,
    meal_tag,
    food_note,
    logged_at,
    created_at,
    updated_at,
  };
}

/**
 * Lists food diary rows for one episode from SQLite (same sort as REST helper).
 *
 * @param db - Initialized PowerSync database.
 * @param episodeId - Episode id.
 * @param limit - Max rows (default `50`).
 */
export async function listFoodDiaryEntriesForEpisodePowerSyncDb(
  db: PowerSyncDatabase,
  episodeId: Uuid,
  limit = 50,
): Promise<PresetDataResult<FoodDiaryEntryRow[]>> {
  try {
    const rows = await db.getAll<Record<string, unknown>>(
      `SELECT * FROM food_diary_entries WHERE episode_id = ? ORDER BY logged_at DESC, created_at DESC, id DESC LIMIT ?`,
      [episodeId, limit],
    );
    const out: FoodDiaryEntryRow[] = [];
    for (const r of rows) {
      const m = mapSqliteRowToFoodDiaryEntryRow(r);
      if (m) {
        out.push(m);
      }
    }
    return { ok: true, data: out };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: new PresetDataError('unknown', message, e),
    };
  }
}

/**
 * Inserts a food diary row locally after {@link validateAndNormalizeFoodDiaryCreateCore}.
 *
 * @param db - Initialized PowerSync database.
 * @param row - Insert payload (`episode_id` required for episode-linked entries).
 * @param normalized - Output from {@link validateAndNormalizeFoodDiaryCreateCore} when `ok: true`.
 */
export async function insertFoodDiaryEntryPowerSyncDb(
  db: PowerSyncDatabase,
  row: FoodDiaryEntryInsert,
  normalized: { food_note: string; logged_at: string },
): Promise<PresetDataResult<FoodDiaryEntryRow>> {
  const id = row.id ?? newLocalUuid();
  const now = new Date().toISOString();
  const episodeId =
    row.episode_id === undefined || row.episode_id === null
      ? null
      : String(row.episode_id);
  try {
    await db.execute(
      `INSERT INTO food_diary_entries (id, user_id, episode_id, meal_tag, food_note, logged_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        row.user_id,
        episodeId,
        row.meal_tag,
        normalized.food_note,
        normalized.logged_at,
        now,
        now,
      ],
    );
    const raw = await db.getOptional<Record<string, unknown>>(
      `SELECT * FROM food_diary_entries WHERE id = ?`,
      [id],
    );
    const mapped = raw ? mapSqliteRowToFoodDiaryEntryRow(raw) : null;
    if (!mapped) {
      return {
        ok: false,
        error: new PresetDataError(
          'unknown',
          'Could not read the food diary entry after saving locally.',
        ),
      };
    }
    return { ok: true, data: mapped };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: new PresetDataError('unknown', message, e),
    };
  }
}

/**
 * Updates one food diary row locally using an already-normalized patch.
 *
 * @param db - Initialized PowerSync database.
 * @param entryId - Row id.
 * @param normalizedPatch - From {@link normalizeFoodDiaryEntryUpdate} when `ok: true`.
 */
export async function updateFoodDiaryEntryPowerSyncDb(
  db: PowerSyncDatabase,
  entryId: Uuid,
  normalizedPatch: FoodDiaryEntryUpdate,
): Promise<PresetDataResult<FoodDiaryEntryRow>> {
  const keys = Object.keys(normalizedPatch).filter(
    (k) => normalizedPatch[k as keyof FoodDiaryEntryUpdate] !== undefined,
  );
  if (keys.length === 0) {
    const raw = await db.getOptional<Record<string, unknown>>(
      `SELECT * FROM food_diary_entries WHERE id = ?`,
      [entryId],
    );
    const mapped = raw ? mapSqliteRowToFoodDiaryEntryRow(raw) : null;
    if (!mapped) {
      return {
        ok: false,
        error: new PresetDataError(
          'not_found',
          'Could not find that food diary entry.',
        ),
      };
    }
    return { ok: true, data: mapped };
  }
  const now = new Date().toISOString();
  const assignments: string[] = [];
  const params: unknown[] = [];
  for (const key of keys) {
    const v = normalizedPatch[key as keyof FoodDiaryEntryUpdate];
    assignments.push(`${key} = ?`);
    params.push(v ?? null);
  }
  assignments.push('updated_at = ?');
  params.push(now);
  params.push(entryId);
  try {
    await db.execute(
      `UPDATE food_diary_entries SET ${assignments.join(', ')} WHERE id = ?`,
      params,
    );
    const raw = await db.getOptional<Record<string, unknown>>(
      `SELECT * FROM food_diary_entries WHERE id = ?`,
      [entryId],
    );
    const mapped = raw ? mapSqliteRowToFoodDiaryEntryRow(raw) : null;
    if (!mapped) {
      return {
        ok: false,
        error: new PresetDataError(
          'not_found',
          'Could not find that food diary entry.',
        ),
      };
    }
    return { ok: true, data: mapped };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: new PresetDataError('unknown', message, e),
    };
  }
}

/**
 * Deletes one food diary row locally.
 *
 * @param db - Initialized PowerSync database.
 * @param entryId - Row id.
 * @returns Same boolean contract as {@link deleteFoodDiaryEntry}: `data: true` when a row was
 *   present and removed, `data: false` when no matching row (already deleted or never existed).
 */
export async function deleteFoodDiaryEntryPowerSyncDb(
  db: PowerSyncDatabase,
  entryId: Uuid,
): Promise<PresetDataResult<boolean>> {
  try {
    const existing = await db.getOptional<{ id: string }>(
      `SELECT id FROM food_diary_entries WHERE id = ?`,
      [entryId],
    );
    if (!existing) {
      return { ok: true, data: false };
    }
    await db.execute(`DELETE FROM food_diary_entries WHERE id = ?`, [entryId]);
    return { ok: true, data: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: new PresetDataError('unknown', message, e),
    };
  }
}

/**
 * Deletes dependent rows for one episode so the `episodes` row can be removed locally (mirrors
 * Postgres `ON DELETE CASCADE` / `SET NULL` for replicated tables).
 *
 * @param db - PowerSync database.
 * @param episodeId - `episodes.id`.
 */
async function deleteEpisodeChildRowsPowerSyncDb(
  db: PowerSyncDatabase,
  episodeId: Uuid,
): Promise<void> {
  const now = new Date().toISOString();
  await db.execute(`DELETE FROM episode_media WHERE episode_id = ?`, [
    episodeId,
  ]);
  await db.execute(`DELETE FROM episode_symptoms WHERE episode_id = ?`, [
    episodeId,
  ]);
  await db.execute(`DELETE FROM health_markers WHERE episode_id = ?`, [
    episodeId,
  ]);
  await db.execute(
    `UPDATE food_diary_entries SET episode_id = NULL, updated_at = ? WHERE episode_id = ?`,
    [now, episodeId],
  );
}

/**
 * Deletes `episode_symptoms` for the current pass (same filter as Supabase
 * {@link deleteCurrentPassEpisodeSymptomAnswer}). Removes matching `episode_media` rows first.
 * Storage cleanup is skipped offline (handled when online in a later pass).
 *
 * @param db - PowerSync database.
 * @param args - Episode id, preset line id, and pass boundary from `episodes.post_marker_step_completed_at`.
 */
export async function deleteCurrentPassEpisodeSymptomAnswerPowerSyncDb(
  db: PowerSyncDatabase,
  args: {
    episodeId: Uuid;
    presetSymptomId: Uuid;
    lastPostMarkerStepCompletedAt: string | null;
  },
): Promise<PresetDataResult<boolean>> {
  const { episodeId, presetSymptomId, lastPostMarkerStepCompletedAt } = args;
  try {
    const idSql =
      lastPostMarkerStepCompletedAt == null ||
      lastPostMarkerStepCompletedAt === ''
        ? `SELECT id FROM episode_symptoms WHERE episode_id = ? AND preset_symptom_id = ?`
        : `SELECT id FROM episode_symptoms WHERE episode_id = ? AND preset_symptom_id = ? AND created_at > ?`;
    const idParams: unknown[] =
      lastPostMarkerStepCompletedAt == null ||
      lastPostMarkerStepCompletedAt === ''
        ? [episodeId, presetSymptomId]
        : [episodeId, presetSymptomId, lastPostMarkerStepCompletedAt];

    const idRows = await db.getAll<{ id: string }>(idSql, idParams);
    const symptomIds = idRows.map((r) => r.id).filter(Boolean);
    if (symptomIds.length > 0) {
      const placeholders = symptomIds.map(() => '?').join(', ');
      await db.execute(
        `DELETE FROM episode_media WHERE episode_id = ? AND episode_symptom_id IN (${placeholders})`,
        [episodeId, ...symptomIds],
      );
    }

    const delSql =
      lastPostMarkerStepCompletedAt == null ||
      lastPostMarkerStepCompletedAt === ''
        ? `DELETE FROM episode_symptoms WHERE episode_id = ? AND preset_symptom_id = ?`
        : `DELETE FROM episode_symptoms WHERE episode_id = ? AND preset_symptom_id = ? AND created_at > ?`;
    await db.execute(
      delSql,
      lastPostMarkerStepCompletedAt == null ||
        lastPostMarkerStepCompletedAt === ''
        ? [episodeId, presetSymptomId]
        : [episodeId, presetSymptomId, lastPostMarkerStepCompletedAt],
    );
    return { ok: true, data: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: new PresetDataError('unknown', message, e),
    };
  }
}

/**
 * Deletes an active episode row locally after removing dependent rows (mirrors Supabase
 * {@link cancelActiveEpisodeById} data effects; Storage cleanup is skipped offline).
 *
 * @param db - PowerSync database.
 * @param episodeId - `episodes.id`.
 */
export async function cancelActiveEpisodeByIdPowerSyncDb(
  db: PowerSyncDatabase,
  episodeId: Uuid,
): Promise<CancelActiveEpisodeByIdResult> {
  try {
    const prior = await db.getOptional<{ ended_at: string | null }>(
      `SELECT ended_at FROM episodes WHERE id = ?`,
      [episodeId],
    );
    if (!prior || prior.ended_at != null) {
      return { ok: true, data: { didCancel: false } };
    }
    await deleteEpisodeChildRowsPowerSyncDb(db, episodeId);
    await db.execute(`DELETE FROM episodes WHERE id = ? AND ended_at IS NULL`, [
      episodeId,
    ]);
    const still = await db.getOptional<{ id: string }>(
      `SELECT id FROM episodes WHERE id = ?`,
      [episodeId],
    );
    return { ok: true, data: { didCancel: still == null } };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: new PresetDataError('unknown', message, e),
    };
  }
}

/**
 * Deletes one episode row locally (active or completed) after removing dependent rows (mirrors
 * Supabase {@link deleteEpisodeById} data effects; Storage cleanup is skipped offline).
 *
 * @param db - PowerSync database.
 * @param episodeId - `episodes.id`.
 */
export async function deleteEpisodeByIdPowerSyncDb(
  db: PowerSyncDatabase,
  episodeId: Uuid,
): Promise<DeleteEpisodeByIdResult> {
  try {
    const exists = await db.getOptional<{ id: string }>(
      `SELECT id FROM episodes WHERE id = ?`,
      [episodeId],
    );
    if (!exists) {
      return { ok: true, data: { didDelete: false } };
    }
    await deleteEpisodeChildRowsPowerSyncDb(db, episodeId);
    await db.execute(`DELETE FROM episodes WHERE id = ?`, [episodeId]);
    const still = await db.getOptional<{ id: string }>(
      `SELECT id FROM episodes WHERE id = ?`,
      [episodeId],
    );
    return { ok: true, data: { didDelete: still == null } };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: new PresetDataError('unknown', message, e),
    };
  }
}
