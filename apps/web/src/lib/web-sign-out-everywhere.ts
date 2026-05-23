/**
 * Performs a full server sign-out via `POST /api/auth/logout` with `scope=global`, revoking
 * refresh tokens on all devices. Navigation happens via the redirect response.
 */
export function webSignOutEverywhere(): void {
  if (typeof document === 'undefined') {
    return;
  }
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/api/auth/logout?scope=global';
  form.setAttribute('aria-hidden', 'true');
  form.style.display = 'none';

  document.body.appendChild(form);
  form.submit();
}
