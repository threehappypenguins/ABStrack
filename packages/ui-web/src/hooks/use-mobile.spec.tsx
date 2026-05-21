import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useIsMobile } from './use-mobile.js';

function ViewportProbe() {
  const isMobile = useIsMobile();
  return <div data-testid="is-mobile">{isMobile ? 'mobile' : 'desktop'}</div>;
}

describe('useIsMobile', () => {
  const originalMatchMedia = window.matchMedia;
  const originalInnerWidth = Object.getOwnPropertyDescriptor(
    window,
    'innerWidth',
  );

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1024,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
    if (originalInnerWidth) {
      Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    } else {
      delete (window as { innerWidth?: number }).innerWidth;
    }
    vi.restoreAllMocks();
  });

  it('uses innerWidth when matchMedia is unavailable', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 360,
    });

    render(<ViewportProbe />);

    expect(screen.getByTestId('is-mobile')).toHaveTextContent('mobile');
  });

  it('updates when the viewport resizes without matchMedia', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1024,
    });

    render(<ViewportProbe />);
    expect(screen.getByTestId('is-mobile')).toHaveTextContent('desktop');

    await act(async () => {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        writable: true,
        value: 360,
      });
      window.dispatchEvent(new Event('resize'));
    });

    expect(screen.getByTestId('is-mobile')).toHaveTextContent('mobile');
  });
});
