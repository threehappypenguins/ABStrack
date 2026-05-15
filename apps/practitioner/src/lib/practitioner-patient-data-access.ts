import type { PractitionerAppGate } from '@abstrack/supabase';

/**
 * Explains why patient-data routes must stay closed for a practitioner session.
 *
 * TOTP + AAL2 apply only when the account uses password sign-in (credential-stuffing risk).
 * Magic-link–only practitioners may access patient routes without enrolling TOTP (RLS matches).
 *
 * @param gate - Resolved gate when `kind === 'practitioner'`.
 * @param verifiedTotpCount - Verified TOTP factors from `auth.mfa.listFactors()`.
 * @param passwordSignInEnabled - From `practitionerUserHasPasswordSignIn` on the session user.
 * @returns `none` when access is allowed; otherwise the first blocking reason.
 */
export function getPatientDataMfaBlockReason(
  gate: Extract<PractitionerAppGate, { kind: 'practitioner' }>,
  verifiedTotpCount: number,
  passwordSignInEnabled: boolean,
): 'none' | 'enrollment' | 'aal2' {
  if (!passwordSignInEnabled) {
    return 'none';
  }
  if (verifiedTotpCount < 1) {
    return 'enrollment';
  }
  if (!gate.hasMfaAssuranceAal2) {
    return 'aal2';
  }
  return 'none';
}
