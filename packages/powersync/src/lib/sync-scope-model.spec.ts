import {
  visiblePatientUserIdsForPhiSync,
  type SyncScopeModelInput,
} from './sync-scope-model.js';

const patientId = '11111111-1111-1111-1111-111111111111';
const caretakerId = '22222222-2222-2222-2222-222222222222';
const practitionerId = '33333333-3333-3333-3333-333333333333';

describe('visiblePatientUserIdsForPhiSync (sync-rules smoke)', () => {
  it('patient receives own user id only', () => {
    const input: SyncScopeModelInput = {
      userId: patientId,
      appRole: 'patient',
      jwtAal: null,
      caretakerGrants: [],
      practitionerGrants: [],
    };
    expect(visiblePatientUserIdsForPhiSync(input)).toEqual([patientId]);
  });

  it('caretaker receives linked patient ids from active grants', () => {
    const input: SyncScopeModelInput = {
      userId: caretakerId,
      appRole: 'caretaker',
      jwtAal: null,
      caretakerGrants: [
        {
          patient_user_id: patientId,
          caretaker_user_id: caretakerId,
          revoked_at: null,
        },
      ],
      practitionerGrants: [],
    };
    expect(visiblePatientUserIdsForPhiSync(input)).toEqual([patientId]);
  });

  it('caretaker ignores revoked links', () => {
    const input: SyncScopeModelInput = {
      userId: caretakerId,
      appRole: 'caretaker',
      jwtAal: null,
      caretakerGrants: [
        {
          patient_user_id: patientId,
          caretaker_user_id: caretakerId,
          revoked_at: '2026-01-01T00:00:00Z',
        },
      ],
      practitionerGrants: [],
    };
    expect(visiblePatientUserIdsForPhiSync(input)).toEqual([]);
  });

  it('practitioner receives granted patient ids only when JWT aal is aal2', () => {
    const granted: SyncScopeModelInput = {
      userId: practitionerId,
      appRole: 'practitioner',
      jwtAal: 'aal2',
      caretakerGrants: [],
      practitionerGrants: [
        {
          patient_user_id: patientId,
          practitioner_user_id: practitionerId,
          revoked_at: null,
        },
      ],
    };
    expect(visiblePatientUserIdsForPhiSync(granted)).toEqual([patientId]);

    const noMfa: SyncScopeModelInput = {
      ...granted,
      jwtAal: 'aal1',
    };
    expect(visiblePatientUserIdsForPhiSync(noMfa)).toEqual([]);
  });

  it('practitioner ignores revoked grants even with aal2', () => {
    const input: SyncScopeModelInput = {
      userId: practitionerId,
      appRole: 'practitioner',
      jwtAal: 'aal2',
      caretakerGrants: [],
      practitionerGrants: [
        {
          patient_user_id: patientId,
          practitioner_user_id: practitionerId,
          revoked_at: '2026-02-01T00:00:00Z',
        },
      ],
    };
    expect(visiblePatientUserIdsForPhiSync(input)).toEqual([]);
  });
});
