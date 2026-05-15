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

  it('allows magic-link-only practitioners without TOTP or AAL2', () => {
    expect(getPatientDataMfaBlockReason(practitioner(true), 0, false)).toBe(
      'none',
    );
    expect(getPatientDataMfaBlockReason(practitioner(false), 0, false)).toBe(
      'none',
    );
  });

  it('blocks password sign-in when no verified TOTP even if AAL2 is true', () => {
    expect(getPatientDataMfaBlockReason(practitioner(true), 0, true)).toBe(
      'enrollment',
    );
  });

  it('blocks password sign-in enrollment before AAL2 when counts are inconsistent', () => {
    expect(getPatientDataMfaBlockReason(practitioner(false), 0, true)).toBe(
      'enrollment',
    );
  });

  it('blocks password sign-in AAL2 when enrolled but session is not AAL2', () => {
    expect(getPatientDataMfaBlockReason(practitioner(false), 1, true)).toBe(
      'aal2',
    );
  });

  it('allows password sign-in when enrolled and AAL2', () => {
    expect(getPatientDataMfaBlockReason(practitioner(true), 1, true)).toBe(
      'none',
    );
  });
});
