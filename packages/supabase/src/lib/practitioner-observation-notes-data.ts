import { PresetDataError } from './preset-data-error.js';
import type { PresetDataResult } from './preset-data.js';
import { wrap, wrapDeleteExpectOne } from './preset-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

/** Matches `practitioner_observation_notes.body` CHECK (`char_length(body) <= 16000`). */
export const PRACTITIONER_OBSERVATION_NOTE_BODY_MAX_LENGTH = 16_000;

/** One row from `practitioner_observation_notes` for practitioner authoring UI. */
export type PractitionerObservationNoteRow = {
  id: string;
  patientUserId: string;
  episodeId: string | null;
  practitionerUserId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

type PractitionerObservationNoteDbRow = {
  id: string;
  patient_user_id: string;
  episode_id: string | null;
  practitioner_user_id: string;
  body: string;
  created_at: string;
  updated_at: string;
};

function mapRow(
  row: PractitionerObservationNoteDbRow,
): PractitionerObservationNoteRow {
  return {
    id: row.id,
    patientUserId: row.patient_user_id,
    episodeId: row.episode_id,
    practitionerUserId: row.practitioner_user_id,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Validates practitioner observation note body before insert/update.
 *
 * @param body - Raw textarea value.
 * @returns Trimmed body on success.
 */
export function validatePractitionerObservationNoteBody(
  body: string,
): PresetDataResult<string> {
  const trimmed = body.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: new PresetDataError(
        'validation_error',
        'Enter observation note text before saving.',
      ),
    };
  }
  if (trimmed.length > PRACTITIONER_OBSERVATION_NOTE_BODY_MAX_LENGTH) {
    return {
      ok: false,
      error: new PresetDataError(
        'validation_error',
        `Observation notes must be ${PRACTITIONER_OBSERVATION_NOTE_BODY_MAX_LENGTH.toLocaleString()} characters or fewer.`,
      ),
    };
  }
  return { ok: true, data: trimmed };
}

const NOTE_SELECT =
  'id, patient_user_id, episode_id, practitioner_user_id, body, created_at, updated_at';

/**
 * Lists practitioner observation notes for a patient (patient-level and episode-scoped),
 * newest first.
 *
 * @param client - Browser Supabase client (practitioner session with grant + MFA).
 * @param patientUserId - Patient `auth.users.id`.
 */
export async function listPractitionerObservationNotesForPatient(
  client: AbstrackSupabaseClient,
  patientUserId: string,
): Promise<PresetDataResult<PractitionerObservationNoteRow[]>> {
  return wrap(async () => {
    const { data, error } = await client
      .from('practitioner_observation_notes')
      .select(NOTE_SELECT)
      .eq('patient_user_id', patientUserId)
      .order('created_at', { ascending: false });

    if (error) {
      return { data: null, error };
    }

    const rows = (data ?? []) as PractitionerObservationNoteDbRow[];
    return { data: rows.map(mapRow), error: null };
  });
}

/**
 * Inserts a practitioner observation note for the signed-in practitioner (`practitioner_user_id`).
 *
 * @param client - Browser Supabase client.
 * @param params.patientUserId - Patient the note belongs to.
 * @param params.practitionerUserId - Signed-in practitioner id (must match session).
 * @param params.episodeId - When set, ties the note to that episode; omit for patient-record notes.
 * @param params.body - Note text (validated and trimmed).
 */
export async function createPractitionerObservationNote(
  client: AbstrackSupabaseClient,
  params: {
    patientUserId: string;
    practitionerUserId: string;
    episodeId?: string | null;
    body: string;
  },
): Promise<PresetDataResult<PractitionerObservationNoteRow>> {
  const validated = validatePractitionerObservationNoteBody(params.body);
  if (!validated.ok) {
    return validated;
  }

  return wrap(async () => {
    const { data, error } = await client
      .from('practitioner_observation_notes')
      .insert({
        patient_user_id: params.patientUserId,
        practitioner_user_id: params.practitionerUserId,
        episode_id: params.episodeId ?? null,
        body: validated.data,
      })
      .select(NOTE_SELECT)
      .single();

    if (error) {
      return { data: null, error };
    }

    return {
      data: mapRow(data as PractitionerObservationNoteDbRow),
      error: null,
    };
  });
}

/**
 * Updates the body of an existing practitioner observation note (own rows only per RLS).
 *
 * @param client - Browser Supabase client.
 * @param params.noteId - Note primary key.
 * @param params.body - Replacement text (validated and trimmed).
 */
export async function updatePractitionerObservationNote(
  client: AbstrackSupabaseClient,
  params: { noteId: string; body: string },
): Promise<PresetDataResult<PractitionerObservationNoteRow>> {
  const validated = validatePractitionerObservationNoteBody(params.body);
  if (!validated.ok) {
    return validated;
  }

  return wrap(async () => {
    const { data, error } = await client
      .from('practitioner_observation_notes')
      .update({ body: validated.data })
      .eq('id', params.noteId)
      .select(NOTE_SELECT)
      .single();

    if (error) {
      return { data: null, error };
    }

    return {
      data: mapRow(data as PractitionerObservationNoteDbRow),
      error: null,
    };
  });
}

/**
 * Deletes a practitioner observation note (own rows only per RLS).
 * Requires `practitioner_observation_notes_delete` policy (migration `20260520120000_practitioner_observation_notes_delete.sql`).
 * When no row matches (missing id or RLS hides it), returns `not_found` like other preset deletes.
 *
 * @param client - Browser Supabase client.
 * @param noteId - Note primary key.
 */
export async function deletePractitionerObservationNote(
  client: AbstrackSupabaseClient,
  noteId: string,
): Promise<PresetDataResult<void>> {
  return wrapDeleteExpectOne(async () => {
    const r = await client
      .from('practitioner_observation_notes')
      .delete()
      .eq('id', noteId)
      .select('id')
      .single();
    return { data: r.data, error: r.error };
  });
}
