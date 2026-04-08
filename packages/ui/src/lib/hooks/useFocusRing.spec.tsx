import { act, renderHook } from '@testing-library/react';
import { useFocusRing } from './useFocusRing.js';

describe('useFocusRing', () => {
  beforeEach(() => {
    act(() => {
      window.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
      );
    });
  });

  it('sets focused when focus follows Tab', () => {
    const { result } = renderHook(() => useFocusRing());

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
    const { result } = renderHook(() => useFocusRing());

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
    const { result } = renderHook(() => useFocusRing());

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
});
