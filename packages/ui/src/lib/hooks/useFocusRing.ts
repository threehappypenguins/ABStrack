import { useCallback, useState } from 'react';
import type { NativeSyntheticEvent, TargetedEvent } from 'react-native';

/**
 * Tracks focus state for focus-visible styling (primarily web; no-ops usefully on native).
 *
 * @returns `focused` flag plus `onFocus` / `onBlur` handlers to spread onto a focusable view.
 */
export function useFocusRing(): {
  focused: boolean;
  onFocus: (e: NativeSyntheticEvent<TargetedEvent>) => void;
  onBlur: (e: NativeSyntheticEvent<TargetedEvent>) => void;
} {
  const [focused, setFocused] = useState(false);
  const onFocus = useCallback(() => {
    setFocused(true);
  }, []);
  const onBlur = useCallback(() => {
    setFocused(false);
  }, []);
  return { focused, onFocus, onBlur };
}
