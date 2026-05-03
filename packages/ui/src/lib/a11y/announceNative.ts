import { AccessibilityInfo } from 'react-native';
import type { AnnounceOptions } from './types.js';

/**
 * Announces a short message to assistive technologies (VoiceOver, TalkBack).
 * Prefer this for transient feedback (save confirmation, validation).
 * For text that stays on screen, use `accessibilityLabel` / `accessibilityLiveRegion`
 * on the relevant `View` where appropriate.
 *
 * `politeness` is accepted for API parity with web {@link useAnnounce}; React Native
 * does not expose the same queue semantics on all platforms—both values use
 * `AccessibilityInfo.announceForAccessibility`.
 *
 * If `announceForAccessibility` returns a rejected promise (seen on some RN builds), the
 * rejection is swallowed so callers do not surface an unhandled rejection in LogBox.
 *
 * @param message - Message to announce; whitespace-only strings are ignored.
 * @param _options - Optional settings (e.g. `politeness` for parity with web); not used on RN yet.
 */
export function announce(message: string, _options?: AnnounceOptions): void {
  const trimmed = message.trim();
  if (!trimmed) {
    return;
  }
  try {
    const out = AccessibilityInfo.announceForAccessibility(trimmed) as unknown;
    if (
      out != null &&
      typeof out === 'object' &&
      'catch' in out &&
      typeof (out as Promise<unknown>).catch === 'function'
    ) {
      void (out as Promise<unknown>).catch(() => {
        /* RN can reject with e.g. TypeError; avoid unhandled rejections in LogBox */
      });
    }
  } catch {
    /* sync failure — ignore */
  }
}
