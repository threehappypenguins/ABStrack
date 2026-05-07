import { messageLooksLikeFetchTransportFailure } from '../network/fetch-transport-failure-heuristic';

/**
 * Detects PostgREST / Postgres failures where retrying the same CRUD batch is unlikely to succeed
 * (RLS, FK, check constraints, client errors). The PowerSync upload connector uses this to call
 * `CrudBatch.complete()` and dequeue, avoiding an infinite retry loop that blocks later writes.
 *
 * **Conservative:** unknown or transport-shaped errors return `false` so the connector keeps the
 * transient “retry when online” behavior. HTTP **401**, **408**, and **429** are never permanent
 * here (even without a PostgREST `code`): JWT refresh, request timeouts from gateways/upstream, and
 * rate limits should retry with backoff instead of `batch.complete()` dropping the queue.
 *
 * Postgres SQLSTATE **40001** / **40P01** / **57014** and connection-class **08\*** codes are
 * evaluated **before** the generic HTTP **4xx** bucket so Supabase errors that carry both `status`
 * (often **409**) and a retryable `code` are not dequeued as permanent. HTTP **408** is excluded
 * from that bucket so gateway timeouts are not dequeued as validation-style failures.
 *
 * PostgREST **`PGRST*`** codes are **not** broadly permanent: connection (**PGRST000–003**), schema
 * cache (**PGRST200–205**), and JWT (**PGRST301–303**, **PGRST300**) failures often recover after
 * pool/schema/auth settles; only **group‑1 API request** codes in `PERMANENT_PGRST_API_CODES` dequeue
 * as permanent. Unknown `PGRST…` values stay retryable.
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
  // Request timeout (client or gateway) — usually transient; do not dequeue as permanent 4xx.
  if (status === 408) {
    return false;
  }

  const code = extractPostgrestCode(error);
  if (code) {
    if (code.startsWith('08')) {
      return false;
    }
    if (code === '40001' || code === '40P01' || code === '57014') {
      return false;
    }
    if (RETRYABLE_PGRST_CODES.has(code) || code === '401') {
      return false;
    }
  }

  if (status != null && status >= 400 && status < 500) {
    if (
      code != null &&
      code.startsWith('PGRST') &&
      !PERMANENT_PGRST_API_CODES.has(code)
    ) {
      return false;
    }
    return true;
  }

  if (!code) {
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
  if (PERMANENT_PGRST_API_CODES.has(code)) {
    return true;
  }

  return false;
}

/**
 * PostgREST codes that should **not** dequeue: connection (**PGRST000–003**), schema cache
 * (**PGRST200–205**), JWT / config (**PGRST300–303**), internal **500**-class API errors (**PGRST111**,
 * **PGRST112**, **PGRST121**, **PGRSTX00**). See [PostgREST errors](https://postgrest.org/en/stable/references/errors.html).
 */
const RETRYABLE_PGRST_CODES = new Set([
  'PGRST000',
  'PGRST001',
  'PGRST002',
  'PGRST003',
  'PGRST200',
  'PGRST201',
  'PGRST202',
  'PGRST203',
  'PGRST204',
  'PGRST205',
  'PGRST300',
  'PGRST301',
  'PGRST302',
  'PGRST303',
  'PGRST111',
  'PGRST112',
  'PGRST121',
  'PGRSTX00',
]);

/**
 * PostgREST [group 1 — API request](https://postgrest.org/en/stable/references/errors.html#group-1-api-request)
 * **4xx-class** codes only (bad query params, body, range, verb, etc.). **500**-class group‑1 codes
 * live in `RETRYABLE_PGRST_CODES`.
 */
const PERMANENT_PGRST_API_CODES = new Set([
  'PGRST100',
  'PGRST101',
  'PGRST102',
  'PGRST103',
  'PGRST105',
  'PGRST106',
  'PGRST107',
  'PGRST108',
  'PGRST114',
  'PGRST115',
  'PGRST116',
  'PGRST117',
  'PGRST118',
  'PGRST120',
  'PGRST122',
  'PGRST123',
  'PGRST124',
  'PGRST125',
  'PGRST126',
  'PGRST127',
  'PGRST128',
]);

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
