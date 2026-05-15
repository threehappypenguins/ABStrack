import { toPresetDataError } from './preset-data-error.js';
import type { PresetDataResult } from './preset-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

/** One active practitioner_access grant with optional patient profile label fields. */
export type PractitionerPatientDirectoryEntry = {
  grantId: string;
  patientUserId: string;
  patientDisplayName: string | null;
  grantedAt: string;
};

/**
 * Accessible list label when `display_name` is unset (no email in directory; grant id only).
 *
 * @param patientUserId - Patient auth user id from `practitioner_access.patient_user_id`.
 * @param patientDisplayName - `profiles.display_name` when RLS allows.
 * @returns Primary link text for the patient row.
 */
export function formatPractitionerPatientDirectoryLabel(
  patientUserId: string,
  patientDisplayName: string | null,
): string {
  const trimmed = patientDisplayName?.trim();
  if (trimmed) {
    return trimmed;
  }
  const compact = patientUserId.replace(/-/g, '').slice(0, 8).toUpperCase();
  return `Patient ${compact}`;
}

type PractitionerAccessGrantRow = {
  id: string;
  patient_user_id: string;
  created_at: string;
};

type PatientProfileLabelRow = {
  id: string;
  display_name: string | null;
};

/**
 * Lists patients who have granted the signed-in practitioner an active `practitioner_access` row.
 * Grant rows use existing RLS; patient `display_name` requires
 * `profiles_practitioner_granted_patient_select` (same MFA path as PHI).
 *
 * @param client - Browser Supabase client (practitioner session).
 * @returns Sorted directory entries (oldest grant first).
 */
export async function listActivePractitionerPatientDirectory(
  client: AbstrackSupabaseClient,
): Promise<PresetDataResult<PractitionerPatientDirectoryEntry[]>> {
  try {
    const { data: grantRows, error: grantError } = await client
      .from('practitioner_access')
      .select('id, patient_user_id, created_at')
      .is('revoked_at', null)
      .order('created_at', { ascending: true });

    if (grantError) {
      return { ok: false, error: toPresetDataError(grantError) };
    }

    const grants = (grantRows ?? []) as PractitionerAccessGrantRow[];
    if (grants.length === 0) {
      return { ok: true, data: [] };
    }

    const patientIds = [...new Set(grants.map((row) => row.patient_user_id))];

    const { data: profileRows, error: profileError } = await client
      .from('profiles')
      .select('id, display_name')
      .in('id', patientIds);

    if (profileError) {
      return { ok: false, error: toPresetDataError(profileError) };
    }

    const displayByPatientId = new Map<string, string | null>();
    for (const row of (profileRows ?? []) as PatientProfileLabelRow[]) {
      displayByPatientId.set(row.id, row.display_name ?? null);
    }

    const entries: PractitionerPatientDirectoryEntry[] = grants.map(
      (grant) => ({
        grantId: grant.id,
        patientUserId: grant.patient_user_id,
        patientDisplayName:
          displayByPatientId.get(grant.patient_user_id) ?? null,
        grantedAt: grant.created_at,
      }),
    );

    return { ok: true, data: entries };
  } catch (error) {
    return {
      ok: false,
      error: toPresetDataError(error),
    };
  }
}

/**
 * @param iso - `practitioner_access.created_at` timestamp.
 * @returns Locale-formatted grant date for list secondary text.
 */
export function formatPractitionerPatientGrantedAt(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    return iso;
  }
  return new Date(t).toLocaleDateString(undefined, {
    dateStyle: 'medium',
  });
}
