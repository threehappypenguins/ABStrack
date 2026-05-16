import type { ReactNode } from 'react';
import { PractitionerPatientRoutesGate } from '@/components/practitioner-patient-routes-gate';

/**
 * Patient-data routes: wraps children in `PractitionerPatientRoutesGate` (patient-data MFA rules for
 * password sign-in; magic-link-only accounts are not required to complete MFA).
 *
 * @param props - Nested segment content.
 * @returns Gate-wrapped subtree.
 */
export default function PatientsLayout({ children }: { children: ReactNode }) {
  return (
    <PractitionerPatientRoutesGate>{children}</PractitionerPatientRoutesGate>
  );
}
