import { userSignOutEverywhere } from '@/lib/user-mfa-device-trust';

/**
 * Performs a full server sign-out via `POST /api/auth/logout` with `scope=global`, revoking
 * refresh tokens on all devices. Clears the MFA trust bundle and any `sb-*-auth-token` keys in
 * browser storage on this origin before navigation. Navigation happens via the redirect response.
 */
export function webSignOutEverywhere(): void {
  userSignOutEverywhere();
}
