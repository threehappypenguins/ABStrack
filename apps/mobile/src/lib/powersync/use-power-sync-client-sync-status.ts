import { useEffect, useState } from 'react';
import type { SyncStatus } from '@powersync/common';
import type { PowerSyncDatabase } from '@powersync/react-native';

/**
 * Serializable slice of {@link SyncStatus} for UI (footer, diagnostics).
 */
export type PowerSyncClientSyncStatusSnapshot = {
  connected: boolean;
  connecting: boolean;
  uploading: boolean;
  downloading: boolean;
  uploadError: Error | undefined;
  downloadError: Error | undefined;
  lastSyncedAt: Date | undefined;
  hasSynced: boolean | undefined;
  /** Human-readable summary from PowerSync. */
  statusMessage: string;
};

function mapSyncStatus(status: SyncStatus): PowerSyncClientSyncStatusSnapshot {
  const df = status.dataFlowStatus;
  return {
    connected: status.connected,
    connecting: status.connecting,
    uploading: Boolean(df?.uploading),
    downloading: Boolean(df?.downloading),
    uploadError: df?.uploadError,
    downloadError: df?.downloadError,
    lastSyncedAt: status.lastSyncedAt,
    hasSynced: status.hasSynced,
    statusMessage: status.getMessage(),
  };
}

/**
 * Subscribes to PowerSync {@link PowerSyncDatabase#registerListener} `statusChanged` updates so UI
 * can reflect upload/download activity and stream errors without polling.
 *
 * @param database - Open replica handle, or `null` when replication is disabled / not ready.
 * @returns Latest status snapshot, or `null` when there is no database.
 */
export function usePowerSyncClientSyncStatus(
  database: PowerSyncDatabase | null,
): PowerSyncClientSyncStatusSnapshot | null {
  const [snapshot, setSnapshot] =
    useState<PowerSyncClientSyncStatusSnapshot | null>(null);

  useEffect(() => {
    if (!database) {
      setSnapshot(null);
      return;
    }

    setSnapshot(mapSyncStatus(database.currentStatus));

    const dispose = database.registerListener({
      statusChanged: (next) => {
        setSnapshot(mapSyncStatus(next));
      },
    });

    return dispose;
  }, [database]);

  return snapshot;
}
