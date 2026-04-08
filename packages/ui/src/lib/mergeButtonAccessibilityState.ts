import type { AccessibilityState } from 'react-native';

/**
 * Merges caller `accessibilityState` with the `disabled` prop. The `disabled` flag is always
 * taken from `disabled` so it stays aligned with the `Pressable` `disabled` behavior.
 *
 * @param accessibilityState - Optional state from the consumer (e.g. `selected`, `expanded`).
 * @param disabled - `disabled` prop on the button (source of truth for the disabled flag).
 * @returns Merged state for `Pressable`.
 */
export function mergeButtonAccessibilityState(
  accessibilityState: AccessibilityState | undefined,
  disabled: boolean | undefined | null,
): AccessibilityState {
  return {
    ...accessibilityState,
    disabled: !!disabled,
  };
}
