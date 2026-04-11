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
 * @param message - Message to announce; whitespace-only strings are ignored.
 * @param options - Optional settings (e.g. `politeness` for parity with web).
 */
export function announce(message: string, options?: AnnounceOptions): void {
  void options;
  const trimmed = message.trim();
  if (!trimmed) {
    return;
  }
  void AccessibilityInfo.announceForAccessibility(trimmed);
}
