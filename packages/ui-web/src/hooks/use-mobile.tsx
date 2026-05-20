import * as React from 'react';

const MOBILE_BREAKPOINT = 768;

const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

/** Desktop layout when `matchMedia` is unavailable (SSR, tests, older engines). */
function createFallbackMediaQueryList(): MediaQueryList {
  const noop = () => undefined;
  return {
    matches: false,
    media: MOBILE_MEDIA_QUERY,
    onchange: null,
    addListener: noop,
    removeListener: noop,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: () => false,
  } as MediaQueryList;
}

function getMobileMediaQueryList(): MediaQueryList {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return createFallbackMediaQueryList();
  }
  return window.matchMedia(MOBILE_MEDIA_QUERY);
}

function subscribeMobile(onStoreChange: () => void): () => void {
  const mql = getMobileMediaQueryList();

  if ('addEventListener' in mql && typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onStoreChange);
    return () => {
      mql.removeEventListener('change', onStoreChange);
    };
  }

  if ('addListener' in mql && typeof mql.addListener === 'function') {
    mql.addListener(onStoreChange);
    return () => {
      if ('removeListener' in mql && typeof mql.removeListener === 'function') {
        mql.removeListener(onStoreChange);
      }
    };
  }

  return () => undefined;
}

function getMobileSnapshot(): boolean {
  return getMobileMediaQueryList().matches;
}

/** SSR / pre-hydration: assume desktop layout until the client subscribes. */
function getMobileServerSnapshot(): boolean {
  return false;
}

/**
 * Whether the viewport is below the Tailwind `md` breakpoint ({@link MOBILE_BREAKPOINT}px).
 * Uses `matchMedia` so the first client snapshot and subsequent updates stay consistent.
 * Subscribes via `change` when supported, otherwise legacy `addListener` / `removeListener`.
 * Falls back to desktop (`false`) when `matchMedia` is missing.
 *
 * @returns `true` when width is under 768px.
 */
export function useIsMobile(): boolean {
  return React.useSyncExternalStore(
    subscribeMobile,
    getMobileSnapshot,
    getMobileServerSnapshot,
  );
}
