import { PractitionerPatientsPage } from '@/components/practitioner-patients-page';

/**
 * Practitioner patient directory: active `practitioner_access` grants (RLS + MFA gate in layout).
 *
 * @returns Patient workspace list.
 */
export default function PatientsPage() {
  return <PractitionerPatientsPage />;
}
