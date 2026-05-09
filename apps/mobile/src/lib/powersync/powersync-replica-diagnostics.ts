import type { PowerSyncDatabase } from '@powersync/react-native';

/** Bridge fields shown next to replica counts (avoids importing the bridge module from diagnostics). */
export type PowerSyncReplicaDiagnosticsBridgeSlice = {
  powerSyncUrlConfigured: boolean;
  localSqliteInitialized: boolean;
  firstSyncCompleted: boolean;
  firstSyncLandedOnDevice: boolean;
  firstSyncLandingHydrated: boolean;
  syncConnecting: boolean;
  syncError: Error | null;
};

/**
 * Tables counted for replica health. Matches `abstrackPowerSyncSchema` in
 * `apps/mobile/src/lib/powersync/abstrack-app-schema.ts` so counts cover preset/detail rows and
 * episode-scoped data (symptoms, markers, food diary, media), not only top-level preset tables.
 */
const REPLICA_DIAGNOSTICS_TABLES = [
  'profiles',
  'symptom_presets',
  'preset_symptoms',
  'health_marker_presets',
  'preset_health_markers',
  'episode_templates',
  'episodes',
  'episode_symptoms',
  'health_markers',
  'food_diary_entries',
  'episode_media',
  'practitioner_access',
  'practitioner_observation_notes',
  'caretaker_access',
  'access_log',
] as const;

/**
 * Result of {@link runPowerSyncReplicaDiagnostics}: row counts per table, or the first failure.
 * A thrown error from SQL usually means the file could not be opened/decrypted or the schema is broken.
 */
export type PowerSyncReplicaDiagnosticsResult = {
  ok: boolean;
  counts: Partial<Record<(typeof REPLICA_DIAGNOSTICS_TABLES)[number], number>>;
  /** Present when `ok` is false — often SQLCipher/open failures surface here. */
  errorMessage?: string;
  elapsedMs: number;
};

/**
 * Whether replica diagnostics run automatically and the Settings debug control is shown.
 *
 * - **`EXPO_PUBLIC_POWERSYNC_DEBUG=false`**: off everywhere (including Metro), so local `.env` can
 *   silence `[PowerSyncReplicaDiag:…]` without a production build.
 * - **`EXPO_PUBLIC_POWERSYNC_DEBUG=true`**: on even when `__DEV__` is false (release / dev client).
 * - **Unset or any other value**: on in **`__DEV__`** Metro builds only; off in production unless
 *   explicitly set to `true`.
 *
 * Never logs the SQLCipher key.
 *
 * @returns `true` when diagnostics should be available.
 */
export function isPowerSyncReplicaDiagnosticsEnabled(): boolean {
  const flag = process.env.EXPO_PUBLIC_POWERSYNC_DEBUG;
  if (flag === 'false') {
    return false;
  }
  if (flag === 'true') {
    return true;
  }
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

/**
 * Runs cheap `COUNT(*)` queries on the replica diagnostics table set (same names as
 * `abstrackPowerSyncSchema`). Uses the same encrypted handle as the app; if decryption fails,
 * expect `ok: false` and an {@link PowerSyncReplicaDiagnosticsResult.errorMessage}.
 *
 * @param db - Open PowerSync database (after `init`).
 */
export async function runPowerSyncReplicaDiagnostics(
  db: PowerSyncDatabase,
): Promise<PowerSyncReplicaDiagnosticsResult> {
  const started = Date.now();
  const counts: PowerSyncReplicaDiagnosticsResult['counts'] = {};
  try {
    for (const table of REPLICA_DIAGNOSTICS_TABLES) {
      const row = await db.getOptional(
        `SELECT COUNT(*) AS c FROM ${table}`,
        [],
      );
      const rec = row as Record<string, unknown> | undefined;
      const raw = rec?.c;
      const n = typeof raw === 'number' ? raw : Number(raw ?? 0);
      counts[table] = Number.isFinite(n) ? n : 0;
    }
    return {
      ok: true,
      counts,
      elapsedMs: Date.now() - started,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      counts,
      errorMessage: message,
      elapsedMs: Date.now() - started,
    };
  }
}

/**
 * Human-readable summary for {@link Alert.alert} or log lines (truncation-friendly).
 *
 * @param result - From {@link runPowerSyncReplicaDiagnostics}.
 * @param bridge - Current bridge flags from {@link usePowerSyncBridgeState}.
 */
export function formatPowerSyncReplicaDiagnosticsMessage(
  result: PowerSyncReplicaDiagnosticsResult,
  bridge: PowerSyncReplicaDiagnosticsBridgeSlice,
): string {
  const lines: string[] = [
    `queriesOk: ${result.ok}`,
    result.errorMessage ? `queryError: ${result.errorMessage}` : null,
    `elapsedMs: ${result.elapsedMs}`,
    `powerSyncUrlConfigured: ${bridge.powerSyncUrlConfigured}`,
    `localSqliteInitialized: ${bridge.localSqliteInitialized}`,
    `firstSyncCompleted: ${bridge.firstSyncCompleted}`,
    `firstSyncLandedOnDevice: ${bridge.firstSyncLandedOnDevice}`,
    `firstSyncLandingHydrated: ${bridge.firstSyncLandingHydrated}`,
    `syncConnecting: ${bridge.syncConnecting}`,
    `syncError: ${bridge.syncError?.message ?? 'none'}`,
    '--- table row counts ---',
    ...REPLICA_DIAGNOSTICS_TABLES.map(
      (t) => `${t}: ${result.counts[t] ?? '(missing)'}`,
    ),
  ].filter((x): x is string => x != null && x.length > 0);
  return lines.join('\n');
}
