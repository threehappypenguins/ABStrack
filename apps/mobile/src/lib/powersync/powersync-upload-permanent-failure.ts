/**
 * Detects PostgREST / Postgres failures where retrying the same CRUD batch is unlikely to succeed
 * (RLS, FK, check constraints, client errors). The PowerSync upload connector uses this to call
 * `CrudBatch.complete()` and dequeue, avoiding an infinite retry loop that blocks later writes.
 *
 * **Conservative:** unknown or transport-shaped errors return `false` so the connector keeps the
 * transient “retry when online” behavior. HTTP **401** and **429** are never permanent here (even
 * without a PostgREST `code`): JWT refresh and gateway / Supabase rate limits should retry with
 * backoff instead of `batch.complete()` dropping the queue.
 *
 * @param error - Value thrown from Supabase `.from().upsert/update/delete` or similar.
 * @returns `true` when the batch should be completed to unblock the queue despite upload failure.
 */
export function isPowerSyncUploadPermanentServerFailure(
  error: unknown,
): boolean {
  if (error == null || typeof error !== 'object') {
    return false;
  }

  if (isLikelyNetworkTransportFailure(error)) {
    return false;
  }

  const e = error as Record<string, unknown>;
  const status = typeof e.status === 'number' ? e.status : undefined;
  if (status != null && status >= 500) {
    return false;
  }
  // Must run before the generic 4xx bucket: Supabase often surfaces auth as `{ status: 401 }`
  // without `code`; those are retryable after token refresh (same intent as PGRST301 / code 401).
  if (status === 401) {
    return false;
  }
  // Throttling / rate limits from Supabase or an upstream gateway — retry later, do not dequeue.
  if (status === 429) {
    return false;
  }
  if (status != null && status >= 400 && status < 500) {
    return true;
  }

  const code = extractPostgrestCode(error);
  if (!code) {
    return false;
  }

  if (code.startsWith('08')) {
    return false;
  }
  if (code === '40001' || code === '40P01' || code === '57014') {
    return false;
  }
  if (code === 'PGRST301' || code === '401') {
    return false;
  }

  if (code.startsWith('23')) {
    return true;
  }
  if (code === '42501') {
    return true;
  }
  if (code.startsWith('42')) {
    return true;
  }
  if (code.startsWith('PGRST') && code !== 'PGRST301') {
    return true;
  }

  return false;
}

function extractPostgrestCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const e = error as Record<string, unknown>;
  const code = e.code;
  if (typeof code === 'string' && code.length > 0) {
    return code;
  }
  return null;
}

function messageLooksLikeFetchTransportFailure(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('failed to fetch') ||
    m.includes('networkerror when attempting') ||
    m.includes('load failed') ||
    m.includes('network request failed')
  );
}

function isLikelyNetworkTransportFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  if ('name' in error) {
    const name = (error as { name?: string }).name;
    if (name === 'AbortError') {
      return true;
    }
    if (typeof name === 'string' && name.includes('Network')) {
      return true;
    }
  }
  if (
    error instanceof Error &&
    messageLooksLikeFetchTransportFailure(error.message)
  ) {
    return true;
  }
  const rec = error as Record<string, unknown>;
  if (
    typeof rec.message === 'string' &&
    messageLooksLikeFetchTransportFailure(rec.message)
  ) {
    return true;
  }
  return false;
}
