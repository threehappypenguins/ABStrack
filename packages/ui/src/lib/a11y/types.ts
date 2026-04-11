/**
 * Priority for assistive-technology announcements.
 *
 * - `polite`: interrupt after current speech (default for saves, confirmations).
 * - `assertive`: interrupt immediately (errors, urgent session issues)—use sparingly.
 */
export type AnnouncePoliteness = 'polite' | 'assertive';

/**
 * Options for {@link announce} (native) and {@link useAnnounce} (web).
 */
export type AnnounceOptions = {
  politeness?: AnnouncePoliteness;
};
