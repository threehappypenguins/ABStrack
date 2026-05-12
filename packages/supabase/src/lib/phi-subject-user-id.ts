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
 * Loads profile role and, for caretakers, the active grant’s `patient_user_id` via PostgREST (RLS).
 *
 * @param client - Browser or native Supabase client with the user’s session.
 * @param authUserId - Non-empty `auth.users` id (`session.user.id`).
 * @returns PHI scope context, or `{ ok: true, data: null }` when `authUserId` is blank (caller
 *   should treat as signed-out). Caretakers without an active link return a validation error.
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

    const profileAppRole = normalizeAppRole(profileRes.data?.app_role);

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

    const grantRes = await client
      .from('caretaker_access')
      .select('patient_user_id')
      .eq('caretaker_user_id', trimmed)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (grantRes.error) {
      return { ok: false, error: toPresetDataError(grantRes.error) };
    }

    const patientId =
      grantRes.data?.patient_user_id != null
        ? String(grantRes.data.patient_user_id).trim()
        : '';

    if (patientId === '') {
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
        phiSubjectUserId: patientId,
        profileAppRole: 'caretaker',
      },
    };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}
