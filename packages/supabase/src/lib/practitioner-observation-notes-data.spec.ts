import { describe, expect, it, vi } from 'vitest';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';
import {
  createPractitionerObservationNote,
  deletePractitionerObservationNote,
  listPractitionerObservationNotesForPatient,
  PRACTITIONER_OBSERVATION_NOTE_BODY_MAX_LENGTH,
  updatePractitionerObservationNote,
  validatePractitionerObservationNoteBody,
} from './practitioner-observation-notes-data.js';

describe('validatePractitionerObservationNoteBody', () => {
  it('rejects empty and whitespace-only bodies', () => {
    expect(validatePractitionerObservationNoteBody('   ').ok).toBe(false);
  });

  it('trims and accepts non-empty bodies within the limit', () => {
    const result = validatePractitionerObservationNoteBody('  hello  ');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('hello');
    }
  });

  it('rejects bodies over the database max length', () => {
    const tooLong = 'x'.repeat(
      PRACTITIONER_OBSERVATION_NOTE_BODY_MAX_LENGTH + 1,
    );
    expect(validatePractitionerObservationNoteBody(tooLong).ok).toBe(false);
  });
});

describe('listPractitionerObservationNotesForPatient', () => {
  it('maps rows and orders newest first', async () => {
    const order = vi.fn(async () => ({
      data: [
        {
          id: 'note-2',
          patient_user_id: 'patient-1',
          episode_id: null,
          practitioner_user_id: 'prac-1',
          body: 'Second',
          created_at: '2026-05-02T10:00:00.000Z',
          updated_at: '2026-05-02T10:00:00.000Z',
        },
      ],
      error: null,
    }));
    const eq = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ eq }));
    const client = {
      from: vi.fn(() => ({ select })),
    } as unknown as AbstrackSupabaseClient;

    const result = await listPractitionerObservationNotesForPatient(
      client,
      'patient-1',
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([
        {
          id: 'note-2',
          patientUserId: 'patient-1',
          episodeId: null,
          practitionerUserId: 'prac-1',
          body: 'Second',
          createdAt: '2026-05-02T10:00:00.000Z',
          updatedAt: '2026-05-02T10:00:00.000Z',
        },
      ]);
    }
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
  });
});

describe('createPractitionerObservationNote', () => {
  it('inserts a patient-level note with trimmed body', async () => {
    const single = vi.fn(async () => ({
      data: {
        id: 'note-1',
        patient_user_id: 'patient-1',
        episode_id: null,
        practitioner_user_id: 'prac-1',
        body: 'Clinical note',
        created_at: '2026-05-01T10:00:00.000Z',
        updated_at: '2026-05-01T10:00:00.000Z',
      },
      error: null,
    }));
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const client = {
      from: vi.fn(() => ({ insert })),
    } as unknown as AbstrackSupabaseClient;

    const result = await createPractitionerObservationNote(client, {
      patientUserId: 'patient-1',
      practitionerUserId: 'prac-1',
      body: '  Clinical note  ',
    });

    expect(result.ok).toBe(true);
    expect(insert).toHaveBeenCalledWith({
      patient_user_id: 'patient-1',
      practitioner_user_id: 'prac-1',
      episode_id: null,
      body: 'Clinical note',
    });
  });
});

describe('updatePractitionerObservationNote', () => {
  it('updates note body by id', async () => {
    const single = vi.fn(async () => ({
      data: {
        id: 'note-1',
        patient_user_id: 'patient-1',
        episode_id: 'ep-1',
        practitioner_user_id: 'prac-1',
        body: 'Updated',
        created_at: '2026-05-01T10:00:00.000Z',
        updated_at: '2026-05-01T11:00:00.000Z',
      },
      error: null,
    }));
    const select = vi.fn(() => ({ single }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    const client = {
      from: vi.fn(() => ({ update })),
    } as unknown as AbstrackSupabaseClient;

    const result = await updatePractitionerObservationNote(client, {
      noteId: 'note-1',
      body: 'Updated',
    });

    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledWith({ body: 'Updated' });
    expect(eq).toHaveBeenCalledWith('id', 'note-1');
  });
});

describe('deletePractitionerObservationNote', () => {
  it('deletes note by id when a row is returned', async () => {
    const select = vi.fn(async () => ({
      data: [{ id: 'note-1' }],
      error: null,
    }));
    const eq = vi.fn(() => ({ select }));
    const del = vi.fn(() => ({ eq }));
    const client = {
      from: vi.fn(() => ({ delete: del })),
    } as unknown as AbstrackSupabaseClient;

    const result = await deletePractitionerObservationNote(client, 'note-1');

    expect(result.ok).toBe(true);
    expect(eq).toHaveBeenCalledWith('id', 'note-1');
  });

  it('returns permission_denied when delete matches zero rows', async () => {
    const select = vi.fn(async () => ({ data: [], error: null }));
    const eq = vi.fn(() => ({ select }));
    const del = vi.fn(() => ({ eq }));
    const client = {
      from: vi.fn(() => ({ delete: del })),
    } as unknown as AbstrackSupabaseClient;

    const result = await deletePractitionerObservationNote(client, 'note-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('permission_denied');
    }
  });
});
