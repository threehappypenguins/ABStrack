import { describe, expect, it, vi } from 'vitest';
import { assertActivePractitionerGrantForPatient } from './practitioner-patient-observation-read.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

describe('assertActivePractitionerGrantForPatient', () => {
  it('returns permission_denied when practitioner_access has no matching row', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    });
    const is = vi.fn().mockReturnValue({ maybeSingle });
    const eq = vi.fn().mockReturnValue({ is });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const client = { from } as unknown as AbstrackSupabaseClient;

    const result = await assertActivePractitionerGrantForPatient(
      client,
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('permission_denied');

    expect(from).toHaveBeenCalledWith('practitioner_access');
    expect(eq).toHaveBeenCalledWith(
      'patient_user_id',
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    );
    expect(is).toHaveBeenCalledWith('revoked_at', null);
  });
});
