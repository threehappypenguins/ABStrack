import { messageLooksLikeFetchTransportFailure } from '../../lib/network/fetch-transport-failure-heuristic';

const COPY_NETWORK =
  "We couldn't reach the sync service. Check your internet connection, then tap Sync now.";

const COPY_SESSION =
  'Your sign-in may need a refresh. Connect to the internet, open the app again, then try Sync now.';

const COPY_LOCAL_DATABASE =
  'There was a problem with the saved copy of your data on this device. Try Sync now, or restart the app.';

const COPY_SERVER_BUSY =
  'The sync service is temporarily busy. Wait a moment, then tap Sync now.';

const COPY_GENERIC =
  'Sync hit a problem. Tap Sync now, or try again after you reconnect to the internet.';

const COPY_STATUS_TECHNICAL =
  'Sync reported a technical status. Tap Sync now if your data looks out of date.';

/**
 * Reads a best-effort message from an `Error` or duck-typed `{ message?: string }`.
 *
 * @param err - Thrown value or SDK error reference.
 */
function readMessage(
  err: Error | { message?: string } | null | undefined,
): string {
  if (err == null) {
    return '';
  }
  if (typeof (err as Error).message === 'string') {
    return (err as Error).message.trim();
  }
  const m = (err as { message?: string }).message;
  return typeof m === 'string' ? m.trim() : '';
}

/**
 * Maps PowerSync bridge / client upload/download errors to user-facing copy for
 * {@link SyncHealthFooter}. Raw SDK or backend text is never shown.
 *
 * @param err - `syncError` from the bridge, or `uploadError` / `downloadError` from the client.
 * @returns Short, non-technical explanation.
 */
export function userFacingSyncHealthBridgeOrClientError(
  err: Error | { message?: string } | null | undefined,
): string {
  const raw = readMessage(err);
  if (!raw) {
    return COPY_GENERIC;
  }
  const lower = raw.toLowerCase();

  if (messageLooksLikeFetchTransportFailure(raw)) {
    return COPY_NETWORK;
  }
  if (
    lower.includes('jwt') ||
    lower.includes('unauthorized') ||
    lower.includes('session') ||
    lower.includes('invalid refresh') ||
    lower.includes('token') ||
    /\b401\b/.test(lower)
  ) {
    return COPY_SESSION;
  }
  if (
    lower.includes('sqlite') ||
    lower.includes('sqlcipher') ||
    lower.includes('opfs') ||
    lower.includes('database is locked') ||
    lower.includes('disk i/o') ||
    lower.includes('disk full')
  ) {
    return COPY_LOCAL_DATABASE;
  }
  if (
    lower.includes('502') ||
    lower.includes('503') ||
    lower.includes('504') ||
    lower.includes('bad gateway') ||
    lower.includes('service unavailable') ||
    lower.includes('gateway time-out') ||
    lower.includes('gateway timeout')
  ) {
    return COPY_SERVER_BUSY;
  }
  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('enotfound') ||
    lower.includes('network is unreachable')
  ) {
    return COPY_NETWORK;
  }
  if (lower.includes('429') || lower.includes('too many requests')) {
    return COPY_SERVER_BUSY;
  }

  return COPY_GENERIC;
}

/**
 * Softens {@link PowerSyncDatabase} status lines for the detail sheet: short, benign summaries pass
 * through; transport-like or very long / stack-like text is replaced with neutral copy.
 *
 * @param message - `statusMessage` from `usePowerSyncClientSyncStatus` (PowerSync `getMessage()`).
 * @returns Text safe to show to end users, or `null` when there is nothing useful to say.
 */
export function userFacingSyncHealthStatusLine(
  message: string | undefined,
): string | null {
  const raw = typeof message === 'string' ? message.trim() : '';
  if (!raw) {
    return null;
  }
  if (messageLooksLikeFetchTransportFailure(raw)) {
    return COPY_NETWORK;
  }
  const lower = raw.toLowerCase();
  if (
    lower.includes('sqlite') ||
    lower.includes('sqlcipher') ||
    lower.includes('database is locked')
  ) {
    return COPY_LOCAL_DATABASE;
  }
  if (
    lower.includes('error') ||
    lower.includes('failed') ||
    lower.includes('exception') ||
    /\bat\s+/.test(lower) ||
    lower.includes('/users/') ||
    lower.includes('/data/user') ||
    lower.includes('typeerror') ||
    lower.includes('referenceerror')
  ) {
    return COPY_STATUS_TECHNICAL;
  }
  if (raw.length > 160) {
    return COPY_STATUS_TECHNICAL;
  }
  return raw;
}
