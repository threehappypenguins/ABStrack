/**
 * Layout classes for `(public)` routes below {@link WebPublicTopNav} (~4.5rem header).
 * Apply {@link PUBLIC_MAIN_CLASS} on the route-group `<main>`; use {@link PUBLIC_PAGE_CENTER_CLASS}
 * on centered auth/marketing sections inside it.
 */
export const PUBLIC_MAIN_CLASS =
  'app-grid-background flex min-h-[calc(100svh-4.5rem)] min-w-0 flex-col';

/** Fills the public `<main>` and vertically centers a single card or spinner. */
export const PUBLIC_PAGE_CENTER_CLASS =
  'flex min-h-full flex-1 items-center justify-center bg-transparent px-4';
