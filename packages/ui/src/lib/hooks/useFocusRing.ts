import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import type { NativeSyntheticEvent, TargetedEvent } from 'react-native';

/**
 * True after a likely keyboard-navigation key until the next primary-pointer
 * interaction. Mirrors common `:focus-visible` heuristics (Tab / arrows).
 */
let lastFocusFromKeyboard = false;

let modalityListenersAttached = false;

function attachFocusVisibleModalityListeners(): void {
  if (typeof window === 'undefined' || modalityListenersAttached) {
    return;
  }
  modalityListenersAttached = true;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Tab') {
      lastFocusFromKeyboard = true;
      return;
    }
    if (
      e.key === 'ArrowDown' ||
      e.key === 'ArrowUp' ||
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight'
    ) {
      lastFocusFromKeyboard = true;
    }
  };

  const onPointerLikeDown = () => {
    lastFocusFromKeyboard = false;
  };

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('pointerdown', onPointerLikeDown, true);
  /** jsdom omits `PointerEvent`; `mousedown` covers mouse-driven focus. */
  window.addEventListener('mousedown', onPointerLikeDown, true);
  /** Touch taps without pointer events (older engines). */
  window.addEventListener('touchstart', onPointerLikeDown, true);
}

/**
 * Tracks whether a focus ring should be shown, using **focus-visible-style**
 * behavior on web: the ring appears when focus follows keyboard navigation
 * (Tab / arrow keys), not when focus comes from a pointer click.
 * On native, focus ring state stays false (callers typically gate styles with `Platform.OS === 'web'`).
 *
 * @returns `focused` flag plus `onFocus` / `onBlur` handlers to spread onto a focusable view.
 */
export function useFocusRing(): {
  focused: boolean;
  onFocus: (e: NativeSyntheticEvent<TargetedEvent>) => void;
  onBlur: (e: NativeSyntheticEvent<TargetedEvent>) => void;
} {
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'web') {
      attachFocusVisibleModalityListeners();
    }
  }, []);

  const onFocus = useCallback((_e: NativeSyntheticEvent<TargetedEvent>) => {
    if (Platform.OS !== 'web') {
      return;
    }
    setFocused(lastFocusFromKeyboard);
  }, []);

  const onBlur = useCallback((_e: NativeSyntheticEvent<TargetedEvent>) => {
    setFocused(false);
  }, []);

  return { focused, onFocus, onBlur };
}
