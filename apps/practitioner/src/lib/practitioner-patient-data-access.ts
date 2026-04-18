import type { PractitionerAppGate } from '@abstrack/supabase';

/**
 * Explains why patient-data routes must stay closed for a practitioner session.
 *
 * @param gate - Resolved gate when `kind === 'practitioner'`.
 * @param verifiedTotpCount - Verified TOTP factors from `auth.mfa.listFactors()`.
 * @returns `none` when both enrollment and AAL2 are satisfied; otherwise the first blocking reason.
 */
export function getPatientDataMfaBlockReason(
  gate: Extract<PractitionerAppGate, { kind: 'practitioner' }>,
  verifiedTotpCount: number,
): 'none' | 'enrollment' | 'aal2' {
  if (verifiedTotpCount < 1) {
    return 'enrollment';
  }
  if (!gate.hasMfaAssuranceAal2) {
    return 'aal2';
  }
  return 'none';
}
