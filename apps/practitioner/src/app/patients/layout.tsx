'use client';

import type { ReactNode } from 'react';
import { PractitionerPatientRoutesGate } from '@/components/practitioner-patient-routes-gate';

/**
 * Patient-data routes require verified TOTP enrollment and an AAL2 session before rendering.
 *
 * @param props - Nested segment content.
 * @returns Gate-wrapped subtree.
 */
export default function PatientsLayout({ children }: { children: ReactNode }) {
  return (
    <PractitionerPatientRoutesGate>{children}</PractitionerPatientRoutesGate>
  );
}
