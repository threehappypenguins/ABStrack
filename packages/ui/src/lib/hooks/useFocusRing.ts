import { useCallback, useEffect, useState } from 'react';

/** Web/DOM runtimes (Next.js, jsdom); avoids importing `react-native` in shared web chart UI. */
function isWebRuntime(): boolean {
  return typeof window !== 'undefined';
}

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
 * On native, focus ring state stays false (no `window` in standard RN runtimes).
 *
 * @returns `focused` flag plus `onFocus` / `onBlur` handlers to spread onto a focusable view.
 * Handlers take no arguments so they are safe to compose with web DOM and React Native focus events.
 */
export function useFocusRing(): {
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
} {
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (isWebRuntime()) {
      return attachFocusVisibleModalityListeners();
    }
    return undefined;
  }, []);

  const onFocus = useCallback(() => {
    if (!isWebRuntime()) {
      return;
    }
    setFocused(lastFocusFromKeyboard);
  }, []);

  const onBlur = useCallback(() => {
    setFocused(false);
  }, []);

  return { focused, onFocus, onBlur };
}
