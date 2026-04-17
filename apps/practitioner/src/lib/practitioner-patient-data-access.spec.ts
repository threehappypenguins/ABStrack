import type { PractitionerAppGate } from '@abstrack/supabase';
import { getPatientDataMfaBlockReason } from './practitioner-patient-data-access';

describe('getPatientDataMfaBlockReason', () => {
  const practitioner = (
    hasMfaAssuranceAal2: boolean,
  ): Extract<PractitionerAppGate, { kind: 'practitioner' }> => ({
    kind: 'practitioner',
    appRole: 'practitioner',
    hasMfaAssuranceAal2,
  });

  it('blocks when no verified TOTP even if AAL2 is true', () => {
    expect(getPatientDataMfaBlockReason(practitioner(true), 0)).toBe(
      'enrollment',
    );
  });

  it('blocks enrollment before AAL2 when counts are inconsistent', () => {
    expect(getPatientDataMfaBlockReason(practitioner(false), 0)).toBe(
      'enrollment',
    );
  });

  it('blocks AAL2 when enrolled but session is not AAL2', () => {
    expect(getPatientDataMfaBlockReason(practitioner(false), 1)).toBe('aal2');
  });

  it('allows when enrolled and AAL2', () => {
    expect(getPatientDataMfaBlockReason(practitioner(true), 1)).toBe('none');
  });
});
