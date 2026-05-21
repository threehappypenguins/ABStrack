import * as React from 'react';

const MOBILE_BREAKPOINT = 768;

const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function canUseMatchMedia(): boolean {
  return (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  );
}

/**
 * Client-only mobile check: `matchMedia` when available, otherwise `innerWidth`.
 *
 * @returns `true` when the viewport is below {@link MOBILE_BREAKPOINT}.
 */
function getViewportIsMobile(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  if (canUseMatchMedia()) {
    return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
  }
  return window.innerWidth < MOBILE_BREAKPOINT;
}

function subscribeMatchMedia(onStoreChange: () => void): () => void {
  const mql = window.matchMedia(MOBILE_MEDIA_QUERY);

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

function subscribeMobile(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  if (canUseMatchMedia()) {
    return subscribeMatchMedia(onStoreChange);
  }

  window.addEventListener('resize', onStoreChange);
  return () => {
    window.removeEventListener('resize', onStoreChange);
  };
}

function getMobileSnapshot(): boolean {
  return getViewportIsMobile();
}

/** SSR / pre-hydration: assume desktop layout until the client subscribes. */
function getMobileServerSnapshot(): boolean {
  return false;
}

/**
 * Whether the viewport is below the Tailwind `md` breakpoint ({@link MOBILE_BREAKPOINT}px).
 * Uses `matchMedia` when available; otherwise derives from `window.innerWidth` and `resize`.
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
