import { act, renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import { useFocusRing } from './useFocusRing.js';

/**
 * Mounts the hook (so window modality listeners are registered), then dispatches
 * `mousedown` so shared `lastFocusFromKeyboard` state starts in the pointer path.
 * Must run after `renderHook` — a pre-hook `mousedown` does not reach the module listeners.
 */
function renderUseFocusRing() {
  const rendered = renderHook(() => useFocusRing());
  act(() => {
    window.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );
  });
  return rendered;
}

describe('useFocusRing', () => {
  it('sets focused when focus follows Tab', () => {
    const { result } = renderUseFocusRing();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
      );
    });
    act(() => {
      result.current.onFocus({} as never);
    });

    expect(result.current.focused).toBe(true);
  });

  it('does not set focused when focus follows a pointer interaction', () => {
    const { result } = renderUseFocusRing();

    act(() => {
      window.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
      );
    });
    act(() => {
      result.current.onFocus({} as never);
    });

    expect(result.current.focused).toBe(false);
  });

  it('clears focused on blur', () => {
    const { result } = renderUseFocusRing();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }),
      );
    });
    act(() => {
      result.current.onFocus({} as never);
    });
    expect(result.current.focused).toBe(true);

    act(() => {
      result.current.onBlur({} as never);
    });
    expect(result.current.focused).toBe(false);
  });

  it('removes window modality listeners on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useFocusRing());
    unmount();

    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith(
      'pointerdown',
      expect.any(Function),
      true,
    );
    expect(remove).toHaveBeenCalledWith(
      'mousedown',
      expect.any(Function),
      true,
    );
    expect(remove).toHaveBeenCalledWith(
      'touchstart',
      expect.any(Function),
      true,
    );

    remove.mockRestore();
  });
});
