/** Desktop sidebar open-state cookie lifetime (seconds). */
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/** Key used with Cmd/Ctrl for global sidebar toggle. */
export const SIDEBAR_KEYBOARD_SHORTCUT = 'b';

/**
 * Reads persisted desktop sidebar open state from `document.cookie`.
 *
 * @param cookieName - Cookie name (e.g. {@link DEFAULT_SIDEBAR_COOKIE_NAME}).
 * @returns `true` / `false` when set, otherwise `null`.
 */
export function readSidebarOpenCookie(cookieName: string): boolean | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const prefix = `${cookieName}=`;
  for (const entry of document.cookie.split(';')) {
    const trimmed = entry.trim();
    if (!trimmed.startsWith(prefix)) {
      continue;
    }
    const value = trimmed.slice(prefix.length);
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    return null;
  }
  return null;
}

/**
 * Persists desktop sidebar open state (uncontrolled sidebar provider only).
 *
 * @param cookieName - Cookie name.
 * @param open - Whether the desktop sidebar rail is expanded.
 */
export function writeSidebarOpenCookie(
  cookieName: string,
  open: boolean,
): void {
  if (typeof document === 'undefined') {
    return;
  }
  const secure =
    typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? '; Secure'
      : '';
  document.cookie = `${cookieName}=${open}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

/**
 * Whether `target` is a field where modifier+B is used for text editing (not sidebar chrome).
 *
 * @param target - `keydown` event target.
 * @returns `true` when the shortcut should not toggle the sidebar.
 */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    if (
      type === 'button' ||
      type === 'submit' ||
      type === 'reset' ||
      type === 'checkbox' ||
      type === 'radio' ||
      type === 'file' ||
      type === 'hidden' ||
      type === 'image'
    ) {
      return false;
    }
    return true;
  }
  return (
    target.closest(
      '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]',
    ) != null
  );
}

/**
 * macOS / iOS: Cmd+B only — leave Ctrl+B for editor navigation (e.g. move backward).
 *
 * @returns `true` on Apple desktop/mobile platforms.
 */
export function isMacLikePlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const platform = navigator.platform ?? '';
  if (/Mac|iPhone|iPad|iPod/i.test(platform)) {
    return true;
  }
  return /Mac OS X|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/**
 * Whether a `keydown` should toggle the sidebar (Cmd/Ctrl+B), respecting editable focus and platform.
 *
 * @param event - Window `keydown` event.
 * @returns `true` when the handler should toggle the sidebar.
 */
export function shouldToggleSidebarFromKeyboard(event: KeyboardEvent): boolean {
  if (event.key.toLowerCase() !== SIDEBAR_KEYBOARD_SHORTCUT) {
    return false;
  }
  const isMac = isMacLikePlatform();
  const hasShortcutModifier = isMac
    ? event.metaKey
    : event.metaKey || event.ctrlKey;
  if (!hasShortcutModifier) {
    return false;
  }
  return !isEditableKeyboardTarget(event.target);
}
