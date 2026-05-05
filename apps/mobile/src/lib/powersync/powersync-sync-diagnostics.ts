import type { SyncStatus } from '@powersync/common';
import type {
  PowerSyncBackendConnector,
  PowerSyncCredentials,
} from '@powersync/react-native';
import { Base64 } from 'js-base64';

/**
 * FNV-1a 32-bit — deterministic and dependency-free; **not** a cryptographic hash. Used only so
 * debug logs can tell “same subject vs changed” without writing JWT `sub` (user id) in cleartext.
 */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 16 hex chars derived from `sub` for diagnostics correlation; never log the raw claim.
 *
 * @param jwtSub - JWT `sub` claim (authenticated user identifier).
 */
export function fingerprintJwtSubForDiagnostics(jwtSub: string): string {
  const a = fnv1a32(jwtSub);
  const b = fnv1a32(`${jwtSub}:abstrack-powersync-diag`);
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

function stripErrorStack(
  err:
    | {
        name?: string;
        message?: string;
        stack?: string;
      }
    | undefined,
): { name?: string; message?: string } | undefined {
  if (!err) {
    return undefined;
  }
  return {
    name: err.name,
    message: err.message,
  };
}

/**
 * Best-effort JWT payload decode for diagnostics only (no verification).
 *
 * Uses `js-base64` `Base64.decode` (same approach as `ChunkingSecureStore` in
 * `supabase-wiring-core.ts`) so decoding works on Hermes/RN where `atob` may be absent.
 *
 * @param token - Supabase access token or other JWT-shaped string.
 * @returns Selected claims or `null` when not JWT-shaped / parse fails.
 */
export function decodeJwtPayloadUnsafeForDiagnostics(
  token: string,
): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2 || typeof parts[1] !== 'string') {
    return null;
  }
  try {
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    if (pad) {
      base64 += '='.repeat(4 - pad);
    }
    const json = Base64.decode(base64);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Normalizes JWT `aud` for logs (string or string array per RFC 7519).
 *
 * @param payload - Decoded JWT payload.
 */
export function jwtAudFromPayload(
  payload: Record<string, unknown> | null,
): string | string[] | undefined {
  if (!payload) {
    return undefined;
  }
  const aud = payload.aud;
  if (typeof aud === 'string') {
    return aud;
  }
  if (Array.isArray(aud) && aud.every((x) => typeof x === 'string')) {
    return aud as string[];
  }
  return undefined;
}

/**
 * Safe summary of {@link PowerSyncCredentials} for logs (endpoint host, token shape, JWT `aud` /
 * `exp`, fingerprint of `sub`; never the raw token or cleartext `sub`).
 *
 * @param creds - Resolved credentials or `null` when signed out / unavailable.
 */
export function summarizePowerSyncFetchCredentialsForLog(
  creds: PowerSyncCredentials | null,
): Record<string, unknown> {
  if (!creds) {
    return { present: false };
  }
  const { endpoint, token } = creds;
  let endpointHost: string | undefined;
  try {
    endpointHost = new URL(endpoint).hostname;
  } catch {
    endpointHost = undefined;
  }
  const tokenStr = typeof token === 'string' ? token : '';
  const payload =
    tokenStr.length > 0 ? decodeJwtPayloadUnsafeForDiagnostics(tokenStr) : null;
  const exp = typeof payload?.exp === 'number' ? payload.exp : undefined;
  return {
    present: true,
    endpointLength: endpoint.length,
    endpointHost,
    tokenCharLength: tokenStr.length,
    tokenPartCount: tokenStr.length > 0 ? tokenStr.split('.').length : 0,
    jwtAud: jwtAudFromPayload(payload),
    jwtExp: exp,
    jwtExpIso: exp != null ? new Date(exp * 1000).toISOString() : undefined,
    jwtSubFingerprint:
      typeof payload?.sub === 'string' && payload.sub.trim() !== ''
        ? fingerprintJwtSubForDiagnostics(payload.sub)
        : undefined,
  };
}

/**
 * Serializes {@link SyncStatus} for logs: connection flags, `hasSynced`, flow flags, and error **messages**
 * (stacks omitted).
 *
 * @param status - Current PowerSync status from {@link AbstractPowerSyncDatabase#currentStatus}.
 */
export function summarizePowerSyncSyncStatusForLog(
  status: SyncStatus,
): Record<string, unknown> {
  const json = status.toJSON();
  const df = json.dataFlow;
  return {
    message: status.getMessage(),
    connected: json.connected,
    connecting: json.connecting,
    hasSynced: json.hasSynced,
    lastSyncedAt:
      json.lastSyncedAt instanceof Date
        ? json.lastSyncedAt.toISOString()
        : json.lastSyncedAt,
    downloading: df?.downloading,
    uploading: df?.uploading,
    downloadError: stripErrorStack(df?.downloadError),
    uploadError: stripErrorStack(df?.uploadError),
    priorityStatusEntries: json.priorityStatusEntries,
    clientImplementation: status.clientImplementation,
  };
}

/**
 * Wraps a backend connector so each {@link PowerSyncBackendConnector#fetchCredentials} call emits a safe summary.
 *
 * @param connector - Underlying connector (e.g. Supabase JWT).
 * @param onSummary - Receives JSON-stringified {@link summarizePowerSyncFetchCredentialsForLog} output.
 */
export function wrapPowerSyncBackendConnectorWithFetchDiagnostics(
  connector: PowerSyncBackendConnector,
  onSummary: (jsonLine: string) => void,
): PowerSyncBackendConnector {
  return {
    ...connector,
    fetchCredentials: async () => {
      const creds = await connector.fetchCredentials?.();
      onSummary(
        JSON.stringify(summarizePowerSyncFetchCredentialsForLog(creds ?? null)),
      );
      return creds ?? null;
    },
    uploadData: connector.uploadData,
  };
}

/**
 * Registers a `statusChanged` listener that logs **deduped** {@link summarizePowerSyncSyncStatusForLog} payloads.
 *
 * @param db - PowerSync database (must extend {@link AbstractPowerSyncDatabase}).
 * @param onSummary - Receives JSON-stringified status summary when it changes.
 * @returns Dispose function to unregister the listener.
 */
export function registerPowerSyncSyncStatusDiagnostics(
  db: {
    registerListener: (l: {
      statusChanged?: (s: SyncStatus) => void;
    }) => () => void;
  },
  onSummary: (jsonLine: string) => void,
): () => void {
  let last = '';
  const dispose = db.registerListener({
    statusChanged: (next) => {
      const line = JSON.stringify(summarizePowerSyncSyncStatusForLog(next));
      if (line === last) {
        return;
      }
      last = line;
      onSummary(line);
    },
  });
  return dispose;
}
