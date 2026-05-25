/** In-memory flag for the current page load while logout clears auth before navigation. */
let practitionerSignOutPending = false;

/**
 * Marks an in-progress practitioner sign-out so protected pages can avoid flashing
 * signed-out error copy when the app shell remounts before redirect.
 */
export function markPractitionerSignOutPending(): void {
  practitionerSignOutPending = true;
}

/**
 * @returns Whether a practitioner sign-out was initiated in this tab and navigation has not finished.
 */
export function isPractitionerSignOutPending(): boolean {
  return practitionerSignOutPending;
}

/** Clears the pending sign-out flag when logout fails and the user stays on the page. */
export function clearPractitionerSignOutPending(): void {
  practitionerSignOutPending = false;
}

/**
 * True when the UI should show a signing-out state instead of a signed-out guard.
 *
 * @param session - Current auth session from {@link useAuth}.
 * @returns Whether logout is in progress for this tab.
 */
export function isPractitionerSignOutTransition(
  session: { user: { id: string } } | null,
): boolean {
  return session == null && isPractitionerSignOutPending();
}
