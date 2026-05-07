/**
 * Heuristic for common React Native / WebKit / Hermes fetch failures where surfacing raw
 * platform text in async UI is unhelpful (offline / transport).
 *
 * @param message - Error message (matched case-insensitively).
 * @returns Whether the message should be treated like a transport-layer failure.
 */
export function messageLooksLikeFetchTransportFailure(
  message: string,
): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('failed to fetch') ||
    m.includes('networkerror when attempting') ||
    m.includes('load failed') ||
    m.includes('network request failed') ||
    m.includes('the network connection was lost') ||
    m.includes('internet connection appears to be offline') ||
    m.includes('could not connect to the server')
  );
}
