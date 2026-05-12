/**
 * PHI subject resolution for the Expo app: online via PostgREST, optional PowerSync SQLite fallback
 * when the device is explicitly offline and the replica has synced `profiles` / `caretaker_access`.
 */
import { isAppRole, type AppRole } from '@abstrack/types';
import type { PresetDataResult } from '@abstrack/supabase';
import {
  CARETAKER_MULTIPLE_ACTIVE_PATIENTS_MESSAGE,
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
 * Distinct active `caretaker_access.patient_user_id` values for this caretaker in the local replica.
 *
 * Matches {@link resolvePhiSubjectUserContextFromSupabase}: multiple active patients return a
 * validation error instead of picking an arbitrary row.
 *
 * @param db - Open PowerSync database.
 * @param caretakerUserId - `caretaker_access.caretaker_user_id`.
 * @returns Single patient id, `null` when no active grant exists, or a validation error when
 *   multiple distinct active patients are linked.
 */
async function readActiveCaretakerPatientIdFromReplicaDb(
  db: PowerSyncDatabase,
  caretakerUserId: string,
): Promise<PresetDataResult<string | null>> {
  const rows = await db.getAll<{ patient_user_id: unknown }>(
    `SELECT patient_user_id FROM caretaker_access
     WHERE caretaker_user_id = ?
       AND (revoked_at IS NULL OR revoked_at = '')`,
    [caretakerUserId],
  );
  const patientIds = new Set<string>();
  for (const row of rows) {
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
 * Reads {@link PhiSubjectUserContext} from replicated SQLite when the network path is unavailable.
 *
 * When the **`profiles` row is missing** (e.g. before that table has replicated), we must not assume
 * the subject is a patient: an offline caretaker would otherwise get `phiSubjectUserId === authUserId`
 * and write PHI under the wrong user. If an active **`caretaker_access`** row is already present,
 * we still resolve the linked patient; otherwise we return `{ ok: true, data: null }` until replica
 * data is ready (callers should treat like “scope not yet available”, not signed-out).
 *
 * @param db - Open PowerSync database.
 * @param authUserId - Signed-in auth user id.
 * @returns Context or an error; `null` when replica cannot determine scope yet (missing profile and
 *   no local caretaker grant), or blank `authUserId`.
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

    if (profileRow == null) {
      const grant = await readActiveCaretakerPatientIdFromReplicaDb(
        db,
        trimmed,
      );
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
      return { ok: true, data: null };
    }

    const profileAppRole = normalizeAppRole(profileRow.app_role);

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

    const grant = await readActiveCaretakerPatientIdFromReplicaDb(db, trimmed);
    if (!grant.ok) {
      return grant;
    }
    if (grant.data == null) {
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
        phiSubjectUserId: grant.data,
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
