import { describe, expect, it } from 'vitest';

import {
  CARETAKER_MULTIPLE_ACTIVE_PATIENTS_MESSAGE,
  resolvePhiSubjectUserContextFromSupabase,
} from './phi-subject-user-id.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

type ProfileMaybeSingle = Promise<{
  data: { app_role: string } | null;
  error: null;
}>;
type GrantsSelect = Promise<{
  data: Array<{ patient_user_id: string }> | null;
  error: null;
}>;

function makePhiTestClient(opts: {
  profile: ProfileMaybeSingle;
  grants: GrantsSelect;
}): AbstrackSupabaseClient {
  return {
    from(table: string) {
      if (table === 'profiles') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: () => opts.profile,
                };
              },
            };
          },
        };
      }
      if (table === 'caretaker_access') {
        return {
          select() {
            return {
              eq() {
                return {
                  is() {
                    return opts.grants;
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as AbstrackSupabaseClient;
}

describe('resolvePhiSubjectUserContextFromSupabase', () => {
  it('treats missing profile with no caretaker grant as patient self', async () => {
    const uid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const client = makePhiTestClient({
      profile: Promise.resolve({ data: null, error: null }),
      grants: Promise.resolve({ data: [], error: null }),
    });

    const res = await resolvePhiSubjectUserContextFromSupabase(client, uid);
    expect(res).toEqual({
      ok: true,
      data: {
        authUserId: uid,
        phiSubjectUserId: uid,
        profileAppRole: null,
      },
    });
  });

  it('returns validation error when multiple distinct active caretaker grants exist', async () => {
    const client = makePhiTestClient({
      profile: Promise.resolve({
        data: { app_role: 'caretaker' },
        error: null,
      }),
      grants: Promise.resolve({
        data: [
          { patient_user_id: '11111111-1111-1111-1111-111111111111' },
          { patient_user_id: '22222222-2222-2222-2222-222222222222' },
        ],
        error: null,
      }),
    });

    const res = await resolvePhiSubjectUserContextFromSupabase(
      client,
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    );
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.error.code).toBe('validation_error');
    expect(res.error.message).toBe(CARETAKER_MULTIPLE_ACTIVE_PATIENTS_MESSAGE);
  });

  it('dedupes duplicate patient ids from multiple grant rows', async () => {
    const patient = '11111111-1111-1111-1111-111111111111';
    const client = makePhiTestClient({
      profile: Promise.resolve({
        data: { app_role: 'caretaker' },
        error: null,
      }),
      grants: Promise.resolve({
        data: [{ patient_user_id: patient }, { patient_user_id: patient }],
        error: null,
      }),
    });

    const res = await resolvePhiSubjectUserContextFromSupabase(
      client,
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    );
    expect(res).toEqual({
      ok: true,
      data: {
        authUserId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        phiSubjectUserId: patient,
        profileAppRole: 'caretaker',
      },
    });
  });
});
