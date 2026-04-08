import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

/**
 * jsdom does not implement `matchMedia` by default; `usePrefersHighContrast` relies on it on web.
 */
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
