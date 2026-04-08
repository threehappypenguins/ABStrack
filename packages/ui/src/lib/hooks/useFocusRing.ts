import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import type { NativeSyntheticEvent, TargetedEvent } from 'react-native';

/**
 * True after a likely keyboard-navigation key until the next primary-pointer
 * interaction. Mirrors common `:focus-visible` heuristics (Tab / arrows).
 */
let lastFocusFromKeyboard = false;

/** Active `useFocusRing` instances on web; listeners stay mounted while count is positive. */
let modalitySubscriberCount = 0;

let keydownHandler: ((e: KeyboardEvent) => void) | undefined;
let pointerLikeDownHandler: (() => void) | undefined;

/** Subscribes to shared window modality listeners; return value removes this subscriber. */
function attachFocusVisibleModalityListeners(): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  modalitySubscriberCount += 1;

  if (modalitySubscriberCount === 1) {
    keydownHandler = (e: KeyboardEvent) => {
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

    pointerLikeDownHandler = () => {
      lastFocusFromKeyboard = false;
    };

    window.addEventListener('keydown', keydownHandler, true);
    window.addEventListener('pointerdown', pointerLikeDownHandler, true);
    /** jsdom omits `PointerEvent`; `mousedown` covers mouse-driven focus. */
    window.addEventListener('mousedown', pointerLikeDownHandler, true);
    /** Touch taps without pointer events (older engines). */
    window.addEventListener('touchstart', pointerLikeDownHandler, true);
  }

  return () => {
    if (typeof window === 'undefined') {
      return;
    }
    modalitySubscriberCount -= 1;
    if (
      modalitySubscriberCount === 0 &&
      keydownHandler &&
      pointerLikeDownHandler
    ) {
      window.removeEventListener('keydown', keydownHandler, true);
      window.removeEventListener('pointerdown', pointerLikeDownHandler, true);
      window.removeEventListener('mousedown', pointerLikeDownHandler, true);
      window.removeEventListener('touchstart', pointerLikeDownHandler, true);
      keydownHandler = undefined;
      pointerLikeDownHandler = undefined;
      lastFocusFromKeyboard = false;
    }
  };
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
      return attachFocusVisibleModalityListeners();
    }
    return undefined;
  }, []);

  const onFocus = useCallback(() => {
    if (Platform.OS !== 'web') {
      return;
    }
    setFocused(lastFocusFromKeyboard);
  }, []);

  const onBlur = useCallback(() => {
    setFocused(false);
  }, []);

  return { focused, onFocus, onBlur };
}
