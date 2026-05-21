'use client';

import {
  formatPractitionerPatientDirectoryLabel,
  formatPractitionerPatientGrantedAt,
  listActivePractitionerPatientDirectory,
  type PractitionerPatientDirectoryEntry,
} from '@abstrack/supabase';
import { getSupabaseBrowserClient } from '@abstrack/supabase/browser';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; patients: PractitionerPatientDirectoryEntry[] }
  | { kind: 'error'; message: string };

/**
 * Practitioner dashboard: patients with an active `practitioner_access` grant (RLS + MFA gate in
 * parent layout). Accessible list with keyboard-reachable links and empty/error states.
 *
 * @returns Patient directory page content.
 */
export function PractitionerPatientsPage() {
  const { announce } = useAnnounce();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const listId = useId();
  const listHeadingId = `${listId}-heading`;
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });

  const loadPatients = useCallback(async () => {
    setLoadState({ kind: 'loading' });
    const result = await listActivePractitionerPatientDirectory(supabase);
    if (!result.ok) {
      const message =
        result.error.code === 'permission_denied'
          ? 'Patient access requires two-factor sign-in for this session. Sign out, sign in again, and complete MFA when prompted.'
          : result.error.message;
      setLoadState({ kind: 'error', message });
      announce(message, { politeness: 'assertive' });
      return;
    }
    setLoadState({ kind: 'ready', patients: result.data });
    const count = result.data.length;
    announce(
      count === 0
        ? 'No patients with active access.'
        : count === 1
          ? '1 patient with active access.'
          : `${count} patients with active access.`,
      { politeness: 'polite' },
    );
  }, [announce, supabase]);

  useEffect(() => {
    void loadPatients();
  }, [loadPatients]);

  const patients = loadState.kind === 'ready' ? loadState.patients : [];
  const isLoading = loadState.kind === 'loading';
  const errorMessage = loadState.kind === 'error' ? loadState.message : null;

  return (
    <div
      id="practitioner-patients-home"
      className="mx-auto max-w-3xl px-4 py-8 sm:px-6"
    >
      <header>
        <h1 className="text-2xl font-semibold text-app-ink">Patients</h1>
        <p className="mt-2 text-sm text-app-muted">
          People who have granted you access to their ABStrack health records.
        </p>
      </header>

      {isLoading ? (
        <p
          className="mt-8 text-sm text-app-muted"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          Loading your patient list…
        </p>
      ) : null}

      {errorMessage ? (
        <div
          className="mt-8 rounded-xl border border-app-border bg-app-surface p-5 shadow-soft"
          role="alert"
        >
          <p className="text-sm text-app-ink">{errorMessage}</p>
          <button
            type="button"
            onClick={() => void loadPatients()}
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md bg-app-primary-solid px-4 py-2 text-sm font-medium text-app-on-primary-solid transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
          >
            Try again
          </button>
        </div>
      ) : null}

      {!isLoading && !errorMessage && patients.length === 0 ? (
        <div
          className="mt-8 rounded-xl border border-dashed border-app-border bg-app-surface/60 p-6"
          role="status"
          aria-labelledby="practitioner-patients-empty-heading"
        >
          <h2
            id="practitioner-patients-empty-heading"
            className="text-lg font-semibold text-app-ink"
          >
            No patients yet
          </h2>
          <p className="mt-2 text-sm text-app-muted">
            When a patient adds you as their practitioner in the ABStrack app,
            they will appear here. Ask them to send an invite from Settings in
            the patient or caretaker mobile app.
          </p>
        </div>
      ) : null}

      {!isLoading && !errorMessage && patients.length > 0 ? (
        <section className="mt-8" aria-labelledby={listHeadingId}>
          <h2 id={listHeadingId} className="sr-only">
            Patients with active access
          </h2>
          <ul className="space-y-3" role="list">
            {patients.map((patient) => {
              const label = formatPractitionerPatientDirectoryLabel(
                patient.patientUserId,
                patient.patientDisplayName,
              );
              const grantedLabel = formatPractitionerPatientGrantedAt(
                patient.grantedAt,
              );
              return (
                <li key={patient.grantId}>
                  <Link
                    href={`/patients/${patient.patientUserId}`}
                    className="flex min-h-11 flex-col justify-center rounded-xl border border-app-border bg-app-surface px-4 py-3 shadow-soft transition hover:border-app-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
                    aria-label={`${label}, access granted ${grantedLabel}`}
                  >
                    <span className="text-base font-medium text-app-ink">
                      {label}
                    </span>
                    <span className="mt-0.5 text-sm text-app-muted">
                      Access granted {grantedLabel}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
