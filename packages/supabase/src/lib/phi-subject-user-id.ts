/**
 * Resolves which auth user id owns PHI rows (`user_id` on episodes, presets, markers, food diary).
 * Patients act as themselves; caretakers act as their linked patient when an active
 * `caretaker_access` row exists (PRD §7).
 */
import { isAppRole, type AppRole } from '@abstrack/types';

import { PresetDataError, toPresetDataError } from './preset-data-error.js';
import type { PresetDataResult } from './preset-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

/**
 * Signed-in auth user plus the PHI scope user id used for `user_id` / `patient_user_id` filters.
 */
export type PhiSubjectUserContext = {
  /** Supabase Auth subject (`auth.uid()`). */
  authUserId: string;
  /**
   * Value to use for PHI row ownership (`episodes.user_id`, preset `user_id`, etc.) — the patient
   * when the signed-in user is an active caretaker.
   */
  phiSubjectUserId: string;
  /** `profiles.app_role` for {@link authUserId}, when the row exists. */
  profileAppRole: AppRole | null;
};

function normalizeAppRole(raw: unknown): AppRole | null {
  if (typeof raw !== 'string') {
    return null;
  }
  return isAppRole(raw) ? raw : null;
}

/**
 * Shown when the same caretaker has more than one active `caretaker_access` row (different
 * patients). Resolvers cannot pick a PHI subject without an explicit patient selection (PRD §7).
 */
export const CARETAKER_MULTIPLE_ACTIVE_PATIENTS_MESSAGE =
  'You have more than one active patient as caretaker. Ask patients to revoke access you no longer need so only one active link remains, then try again.';

/**
 * Active `caretaker_access` patient scope for this caretaker via PostgREST (RLS).
 *
 * The DB enforces at most one active grant **per patient**, not per caretaker, so multiple active
 * rows for the same caretaker must not be collapsed by `ORDER BY created_at` — that would mis-scope
 * PHI. When more than one distinct `patient_user_id` is active, returns a validation error.
 *
 * @param client - Supabase client with the user’s session.
 * @param caretakerUserId - `caretaker_access.caretaker_user_id`.
 * @returns Non-empty patient id, `null` when no active grant exists, PostgREST errors, or
 *   ambiguous multiple-patient validation failure.
 */
async function fetchActiveCaretakerPatientUserId(
  client: AbstrackSupabaseClient,
  caretakerUserId: string,
): Promise<PresetDataResult<string | null>> {
  const grantRes = await client
    .from('caretaker_access')
    .select('patient_user_id')
    .eq('caretaker_user_id', caretakerUserId)
    .is('revoked_at', null);

  if (grantRes.error) {
    return { ok: false, error: toPresetDataError(grantRes.error) };
  }

  const patientIds = new Set<string>();
  for (const row of grantRes.data ?? []) {
    const id =
      row.patient_user_id != null ? String(row.patient_user_id).trim() : '';
    if (id !== '') {
      patientIds.add(id);
    }
  }

  if (patientIds.size === 0) {
    return { ok: true, data: null };
  }
  if (patientIds.size > 1) {
    return {
      ok: false,
      error: new PresetDataError(
        'validation_error',
        CARETAKER_MULTIPLE_ACTIVE_PATIENTS_MESSAGE,
      ),
    };
  }
  const [onlyPatientId] = patientIds;
  return { ok: true, data: onlyPatientId };
}

/**
 * Loads profile role and, for caretakers, the active grant’s `patient_user_id` via PostgREST (RLS).
 *
 * @param client - Browser or native Supabase client with the user’s session.
 * @param authUserId - Non-empty `auth.users` id (`session.user.id`).
 * @returns PHI scope context, or `{ ok: true, data: null }` when `authUserId` is blank (caller
 *   should treat as signed-out). When the **`profiles` row is missing**, if an active
 *   **`caretaker_access`** row exists the subject resolves as the linked patient; if not, we treat
 *   the user as **patient/self** (`phiSubjectUserId === authUserId`, `profileAppRole: null`) so
 *   sessions without a provisioned profile row (common patient signup paths) are not blocked.
 *   When **`profiles.app_role` is `caretaker`** but there is no active grant, callers still get a
 *   validation error. Multiple distinct active grants for one caretaker also return a validation error.
 */
export async function resolvePhiSubjectUserContextFromSupabase(
  client: AbstrackSupabaseClient,
  authUserId: string,
): Promise<PresetDataResult<PhiSubjectUserContext | null>> {
  const trimmed = authUserId.trim();
  if (trimmed === '') {
    return { ok: true, data: null };
  }

  try {
    const profileRes = await client
      .from('profiles')
      .select('app_role')
      .eq('id', trimmed)
      .maybeSingle();

    if (profileRes.error) {
      return { ok: false, error: toPresetDataError(profileRes.error) };
    }

    if (profileRes.data == null) {
      const grant = await fetchActiveCaretakerPatientUserId(client, trimmed);
      if (!grant.ok) {
        return grant;
      }
      if (grant.data != null) {
        return {
          ok: true,
          data: {
            authUserId: trimmed,
            phiSubjectUserId: grant.data,
            profileAppRole: 'caretaker',
          },
        };
      }
      return {
        ok: true,
        data: {
          authUserId: trimmed,
          phiSubjectUserId: trimmed,
          profileAppRole: null,
        },
      };
    }

    const profileAppRole = normalizeAppRole(profileRes.data.app_role);

    if (profileAppRole !== 'caretaker') {
      return {
        ok: true,
        data: {
          authUserId: trimmed,
          phiSubjectUserId: trimmed,
          profileAppRole,
        },
      };
    }

    const grant = await fetchActiveCaretakerPatientUserId(client, trimmed);
    if (!grant.ok) {
      return grant;
    }
    if (grant.data == null) {
      return {
        ok: false,
        error: new PresetDataError(
          'validation_error',
          'Your caretaker account is not linked to a patient yet. Ask the patient to send an invite from Settings, then open the link from your email.',
        ),
      };
    }

    return {
      ok: true,
      data: {
        authUserId: trimmed,
        phiSubjectUserId: grant.data,
        profileAppRole: 'caretaker',
      },
    };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}
