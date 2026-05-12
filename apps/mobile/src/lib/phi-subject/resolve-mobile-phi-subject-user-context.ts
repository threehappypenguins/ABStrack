/**
 * PHI subject resolution for the Expo app: online via PostgREST, optional PowerSync SQLite fallback
 * when the device is explicitly offline and the replica has synced `profiles` / `caretaker_access`.
 */
import { isAppRole, type AppRole } from '@abstrack/types';
import type { PresetDataResult } from '@abstrack/supabase';
import {
  PresetDataError,
  resolvePhiSubjectUserContextFromSupabase,
  toPresetDataError,
  type PhiSubjectUserContext,
} from '@abstrack/supabase';
import type { PowerSyncDatabase } from '@powersync/react-native';

import { fetchMobileDeviceIsConnected } from '../network/mobile-device-netinfo';
import {
  getMobileAuthSessionSafe,
  getMobileSupabaseClient,
  isAuthSessionRecoveryFailure,
  readPersistedMobileAuthUserId,
} from '../supabase-wiring';

function normalizeAppRole(raw: unknown): AppRole | null {
  return isAppRole(raw) ? raw : null;
}

/**
 * Reads {@link PhiSubjectUserContext} from replicated SQLite when the network path is unavailable.
 *
 * @param db - Open PowerSync database.
 * @param authUserId - Signed-in auth user id.
 * @returns Context or an error; `null` only when role data is missing (treat as unknown offline).
 */
async function resolvePhiSubjectUserContextFromPowerSyncDb(
  db: PowerSyncDatabase,
  authUserId: string,
): Promise<PresetDataResult<PhiSubjectUserContext | null>> {
  const trimmed = authUserId.trim();
  if (trimmed === '') {
    return { ok: true, data: null };
  }
  try {
    const profileRow = await db.getOptional<{ app_role: unknown }>(
      `SELECT app_role FROM profiles WHERE id = ?`,
      [trimmed],
    );
    const profileAppRole = normalizeAppRole(profileRow?.app_role);

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

    const grantRow = await db.getOptional<{ patient_user_id: unknown }>(
      `SELECT patient_user_id FROM caretaker_access
       WHERE caretaker_user_id = ?
         AND (revoked_at IS NULL OR revoked_at = '')
       ORDER BY created_at DESC
       LIMIT 1`,
      [trimmed],
    );
    const patientId =
      grantRow?.patient_user_id != null
        ? String(grantRow.patient_user_id).trim()
        : '';
    if (patientId === '') {
      return {
        ok: false,
        error: new PresetDataError(
          'validation_error',
          'Your caretaker account is not linked to a patient yet. Connect online once after the patient invites you, or ask them to send a new invite.',
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

async function resolveAuthUserIdForPhi(): Promise<
  PresetDataResult<string | null>
> {
  try {
    const {
      data: { session },
      error,
    } = await getMobileAuthSessionSafe();
    if (!error) {
      return { ok: true, data: session?.user?.id ?? null };
    }
    if (!isAuthSessionRecoveryFailure(error)) {
      return { ok: false, error: toPresetDataError(error) };
    }
    const persistedId = await readPersistedMobileAuthUserId();
    if (persistedId != null) {
      return { ok: true, data: persistedId };
    }
    return { ok: false, error: toPresetDataError(error) };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}

export type ResolveMobilePhiSubjectUserContextOptions = {
  /**
   * When set and the device is explicitly offline after a failed or skipped network resolve, used
   * to read `profiles` / `caretaker_access` from the replica.
   */
  powerSyncDatabase?: PowerSyncDatabase | null;
};

/**
 * Resolves {@link PhiSubjectUserContext} for the current mobile session (patient or caretaker).
 *
 * @param options - Optional PowerSync DB for caretaker/patient offline fallback.
 * @returns Same contract as {@link resolvePhiSubjectUserContextFromSupabase}; `data: null` when
 *   there is no auth user id.
 */
export async function resolveMobilePhiSubjectUserContext(
  options?: ResolveMobilePhiSubjectUserContextOptions,
): Promise<PresetDataResult<PhiSubjectUserContext | null>> {
  const auth = await resolveAuthUserIdForPhi();
  if (!auth.ok) {
    return auth;
  }
  if (auth.data == null || auth.data.trim() === '') {
    return { ok: true, data: null };
  }

  const client = getMobileSupabaseClient();
  const connected = await fetchMobileDeviceIsConnected();

  if (connected !== false) {
    const remote = await resolvePhiSubjectUserContextFromSupabase(
      client,
      auth.data,
    );
    if (remote.ok || remote.error.code !== 'network_error') {
      return remote;
    }
    const db = options?.powerSyncDatabase ?? null;
    if (db) {
      return resolvePhiSubjectUserContextFromPowerSyncDb(db, auth.data);
    }
    return remote;
  }

  const db = options?.powerSyncDatabase ?? null;
  if (db) {
    return resolvePhiSubjectUserContextFromPowerSyncDb(db, auth.data);
  }

  const remote = await resolvePhiSubjectUserContextFromSupabase(
    client,
    auth.data,
  );
  return remote;
}
