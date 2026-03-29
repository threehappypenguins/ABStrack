/**
 * `@abstrack/crypto` — non-PHI utilities only. Application-layer PHI encryption is not
 * part of this model; see PRD Technical Stack and Security (plaintext PHI under RLS).
 */
export function crypto(): string {
  return 'crypto';
}
