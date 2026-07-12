import { redirect } from 'next/navigation';

/**
 * Practitioner root: no public landing. The proxy sends signed-out visitors to `/login`;
 * signed-in visitors are redirected to the patient workspace (`/patients`).
 *
 * TOTP enrollment lives at `/mfa` (also linked from Settings → Security).
 */
export default function Index(): never {
  redirect('/patients');
}
