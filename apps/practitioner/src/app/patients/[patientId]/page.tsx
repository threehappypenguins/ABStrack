import { PractitionerPatientDetailPage } from './practitioner-patient-detail-page';

type PatientDetailPageProps = {
  /** Next.js 16 passes dynamic route params as a Promise (await before use). */
  params: Promise<{ patientId: string }>;
};

/**
 * Per-patient practitioner view: read-only PHI timelines (PRD §8). The parent `patients` layout mounts
 * `PractitionerPatientRoutesGate`, which enforces patient-data access rules (verified TOTP and AAL2 for
 * password sign-in accounts; magic-link-only accounts may pass without MFA).
 *
 * @param props - Dynamic route params.
 * @returns Patient detail client tree.
 */
export default async function PatientDetailPage({
  params,
}: PatientDetailPageProps) {
  const { patientId } = await params;

  return <PractitionerPatientDetailPage patientUserId={patientId} />;
}
