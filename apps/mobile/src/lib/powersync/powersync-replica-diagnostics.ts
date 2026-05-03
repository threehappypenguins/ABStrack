import type { PowerSyncDatabase } from '@powersync/react-native';

/** Bridge fields shown next to replica counts (avoids importing the bridge module from diagnostics). */
export type PowerSyncReplicaDiagnosticsBridgeSlice = {
  powerSyncUrlConfigured: boolean;
  localSqliteInitialized: boolean;
  firstSyncCompleted: boolean;
  syncConnecting: boolean;
  syncError: Error | null;
};

/** Tables that should exist once {@link PowerSyncDatabase.init} has run with `abstrackPowerSyncSchema`. */
const REPLICA_DIAGNOSTICS_TABLES = [
  'profiles',
  'symptom_presets',
  'health_marker_presets',
  'episode_templates',
  'episodes',
  'caretaker_access',
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
 * - **`__DEV__`**: enabled in Metro/dev client builds.
 * - **`EXPO_PUBLIC_POWERSYNC_DEBUG=true`**: enable in release/dev-client builds without flipping `__DEV__`
 *   (set in `.env` / EAS env and rebuild).
 *
 * Never logs the SQLCipher key.
 *
 * @returns `true` when diagnostics should be available.
 */
export function isPowerSyncReplicaDiagnosticsEnabled(): boolean {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    return true;
  }
  return process.env.EXPO_PUBLIC_POWERSYNC_DEBUG === 'true';
}

/**
 * Runs cheap `COUNT(*)` queries on replicated tables. Uses the same encrypted handle as the app;
 * if decryption fails, expect `ok: false` and an {@link PowerSyncReplicaDiagnosticsResult.errorMessage}.
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
    `syncConnecting: ${bridge.syncConnecting}`,
    `syncError: ${bridge.syncError?.message ?? 'none'}`,
    '--- table row counts ---',
    ...REPLICA_DIAGNOSTICS_TABLES.map(
      (t) => `${t}: ${result.counts[t] ?? '(missing)'}`,
    ),
  ].filter((x): x is string => x != null && x.length > 0);
  return lines.join('\n');
}
