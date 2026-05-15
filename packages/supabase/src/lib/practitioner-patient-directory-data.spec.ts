import { describe, expect, it, vi } from 'vitest';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';
import {
  formatPractitionerPatientDirectoryLabel,
  formatPractitionerPatientGrantedAt,
  listActivePractitionerPatientDirectory,
} from './practitioner-patient-directory-data.js';

describe('formatPractitionerPatientDirectoryLabel', () => {
  it('uses trimmed display_name when present', () => {
    expect(
      formatPractitionerPatientDirectoryLabel(
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        '  Alex  ',
      ),
    ).toBe('Alex');
  });

  it('falls back to a short patient id token when display_name is empty', () => {
    expect(
      formatPractitionerPatientDirectoryLabel(
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        null,
      ),
    ).toBe('Patient AAAAAAAA');
  });
});

describe('formatPractitionerPatientGrantedAt', () => {
  it('formats a valid ISO timestamp', () => {
    const formatted = formatPractitionerPatientGrantedAt(
      '2026-05-01T12:00:00.000Z',
    );
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatted).not.toBe('2026-05-01T12:00:00.000Z');
  });
});

describe('listActivePractitionerPatientDirectory', () => {
  it('returns an empty list when there are no active grants', async () => {
    const order = vi.fn(async () => ({ data: [], error: null }));
    const is = vi.fn(() => ({ order }));
    const select = vi.fn(() => ({ is }));
    const client = {
      from: vi.fn(() => ({ select })),
    } as unknown as AbstrackSupabaseClient;

    const result = await listActivePractitionerPatientDirectory(client);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([]);
    }
    expect(client.from).toHaveBeenCalledWith('practitioner_access');
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it('merges grant rows with patient display names', async () => {
    const grantOrder = vi.fn(async () => ({
      data: [
        {
          id: 'grant-1',
          patient_user_id: 'patient-1',
          created_at: '2026-05-01T10:00:00.000Z',
        },
      ],
      error: null,
    }));
    const grantIs = vi.fn(() => ({ order: grantOrder }));
    const grantSelect = vi.fn(() => ({ is: grantIs }));

    const profileIn = vi.fn(async () => ({
      data: [{ id: 'patient-1', display_name: 'Sam' }],
      error: null,
    }));
    const profileSelect = vi.fn(() => ({ in: profileIn }));

    const client = {
      from: vi.fn((table: string) => {
        if (table === 'practitioner_access') {
          return { select: grantSelect };
        }
        if (table === 'profiles') {
          return { select: profileSelect };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await listActivePractitionerPatientDirectory(client);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([
        {
          grantId: 'grant-1',
          patientUserId: 'patient-1',
          patientDisplayName: 'Sam',
          grantedAt: '2026-05-01T10:00:00.000Z',
        },
      ]);
    }
    expect(profileIn).toHaveBeenCalledWith('id', ['patient-1']);
  });
});
