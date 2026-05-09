/**
 * UUID v4 for local IDs. React Native often has `getRandomValues` (via
 * `react-native-get-random-values` in app entry) but not always `randomUUID`.
 *
 * @returns RFC 4122 UUID string.
 */
export function newRandomUuidV4(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') {
    return c.randomUUID();
  }
  if (typeof c?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
      '',
    );
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error(
    'Neither crypto.randomUUID nor crypto.getRandomValues is available; ensure react-native-get-random-values is imported at app entry.',
  );
}
