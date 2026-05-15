type PatientDetailPageProps = {
  /** Next.js 16 passes dynamic route params as a Promise (await before use). */
  params: Promise<{ patientId: string }>;
};

/**
 * Per-patient practitioner view (placeholder). The parent layout enforces MFA before this renders.
 *
 * @param props - Dynamic route params.
 * @returns Patient detail shell.
 */
export default async function PatientDetailPage({
  params,
}: PatientDetailPageProps) {
  const { patientId } = await params;

  return (
    <div
      id="practitioner-patient-detail"
      className="mx-auto max-w-3xl px-4 py-8 sm:px-6"
    >
      <h1 className="text-2xl font-semibold text-app-ink">Patient</h1>
      <p className="mt-2 font-mono text-sm text-app-muted">{patientId}</p>
      <p className="mt-4 text-sm text-app-muted">
        Detailed patient tools will appear here as they are implemented.
      </p>
    </div>
  );
}
