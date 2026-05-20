import * as React from 'react';

const MOBILE_BREAKPOINT = 768;

const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function getMobileMediaQueryList(): MediaQueryList {
  return window.matchMedia(MOBILE_MEDIA_QUERY);
}

function subscribeMobile(onStoreChange: () => void): () => void {
  const mql = getMobileMediaQueryList();
  mql.addEventListener('change', onStoreChange);
  return () => mql.removeEventListener('change', onStoreChange);
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
