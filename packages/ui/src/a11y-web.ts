/**
 * Web-only entry: live announcer and types without pulling React Native from the main `@abstrack/ui` barrel.
 * Use this from Next.js apps (especially `apps/practitioner`) for `LiveAnnouncerProvider` / `useAnnounce`.
 */

export * from './lib/a11y/types.js';
export * from './lib/a11y/LiveAnnouncer.js';
