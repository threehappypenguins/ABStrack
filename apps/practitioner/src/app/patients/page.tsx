/**
 * Practitioner patient directory entry point (placeholder). Authorization for PHI remains enforced
 * by Supabase RLS; this route is gated in `patients/layout.tsx` until MFA requirements are met.
 *
 * @returns Patient workspace shell.
 */
export default function PatientsPage() {
  return (
    <div
      id="practitioner-patients-home"
      className="mx-auto max-w-3xl px-4 py-8 sm:px-6"
    >
      <h1 className="text-2xl font-semibold text-app-ink">Patients</h1>
      <p className="mt-2 text-sm text-app-muted">
        Patient workflows will appear here once connected to your account.
      </p>
    </div>
  );
}
