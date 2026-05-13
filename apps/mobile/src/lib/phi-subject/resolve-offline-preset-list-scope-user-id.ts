/**
 * Shared offline / replica preset list scope: explicit PHI owner id vs
 * {@link resolveMobilePhiSubjectUserContext} vs persisted auth fallback.
 *
 * Symptom and health-marker preset services must stay aligned here — do not fork this logic per
 * feature.
 */
import type { PresetDataResult } from '@abstrack/supabase';
import { toPresetDataError } from '@abstrack/supabase';
import type { PowerSyncDatabase } from '@powersync/react-native';

import {
  getMobileAuthSessionSafe,
  isAuthSessionRecoveryFailure,
  readPersistedMobileAuthUserId,
} from '../supabase-wiring';
import { resolveMobilePhiSubjectUserContext } from './resolve-mobile-phi-subject-user-context';

/**
 * Resolves the signed-in user id from the persisted session (offline-safe).
 * Uses {@link getMobileAuthSessionSafe} rather than `getUser()` so airplane mode does not fail the
 * auth lookup. When that helper returns `auth_session_recovery_failed`, falls back to
 * {@link readPersistedMobileAuthUserId} so transient secure-store / recovery hiccups do not block
 * offline PowerSync preset lists.
 *
 * @returns `{ ok: true, data: id }` when signed in; `{ ok: true, data: null }` when signed out
 *   with no auth error; `{ ok: false, error }` when the session read failed.
 */
export async function getMobileAuthUserIdForPresetListOffline(): Promise<
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

/**
 * Resolves which `user_id` to filter on for offline replica preset lists (symptom and health
 * marker presets).
 *
 * When `explicitScopeUserId` is a non-empty string, returns it. Otherwise, when `replicaDb` is
 * set, uses {@link resolveMobilePhiSubjectUserContext} so caretaker sessions query the linked
 * patient’s rows instead of the caretaker auth uid. Falls back to
 * {@link getMobileAuthUserIdForPresetListOffline} when no replica is available or PHI scope is
 * unavailable.
 *
 * @param explicitScopeUserId - Optional PHI row owner from the caller (skips resolver when set).
 * @param replicaDb - Open PowerSync database when reading SQLite; enables PHI resolution when scope is omitted.
 * @returns Trimmed scope user id, null when signed out, or an error.
 */
export async function resolveOfflinePresetListScopeUserId(
  explicitScopeUserId: string | null | undefined,
  replicaDb: PowerSyncDatabase | null,
): Promise<PresetDataResult<string | null>> {
  if (explicitScopeUserId != null) {
    const trimmed = explicitScopeUserId.trim();
    if (trimmed !== '') {
      return { ok: true, data: trimmed };
    }
  }
  if (replicaDb) {
    const phi = await resolveMobilePhiSubjectUserContext({
      powerSyncDatabase: replicaDb,
    });
    if (!phi.ok) {
      return phi;
    }
    const subject =
      phi.data?.phiSubjectUserId != null
        ? phi.data.phiSubjectUserId.trim()
        : '';
    if (subject !== '') {
      return { ok: true, data: subject };
    }
  }
  return getMobileAuthUserIdForPresetListOffline();
}
