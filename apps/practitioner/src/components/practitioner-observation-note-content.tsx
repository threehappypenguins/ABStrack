'use client';

import { useState } from 'react';
import { IconChevronDown } from './IconChevronDown';

/** Collapsed preview uses `line-clamp-3` (~three lines). */
const OBSERVATION_NOTE_PREVIEW_LINE_COUNT = 3;

/** Character count above which a note shows expand/collapse (aligned with timeline detail clamp). */
const OBSERVATION_NOTE_EXPAND_CHAR_THRESHOLD = 160;

/**
 * @param body - Note plaintext.
 * @returns Whether the note should offer expand/collapse instead of showing all at once.
 */
export function observationNoteNeedsExpand(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.length > OBSERVATION_NOTE_EXPAND_CHAR_THRESHOLD) {
    return true;
  }
  return trimmed.split(/\r?\n/).length > OBSERVATION_NOTE_PREVIEW_LINE_COUNT;
}

type PractitionerObservationNoteContentProps = {
  body: string;
};

/**
 * Read-only observation note body: full text when short; otherwise a faded multi-line preview
 * with a bottom chevron control to expand or collapse the full note.
 */
export function PractitionerObservationNoteContent({
  body,
}: PractitionerObservationNoteContentProps) {
  const [expanded, setExpanded] = useState(false);
  const needsExpand = observationNoteNeedsExpand(body);

  if (!needsExpand) {
    return (
      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-app-ink">
        {body}
      </p>
    );
  }

  return (
    <div className="mt-2">
      {expanded ? (
        <p className="whitespace-pre-wrap break-words text-sm text-app-ink">
          {body}
        </p>
      ) : (
        <div className="relative">
          <p className="whitespace-pre-wrap break-words text-sm text-app-ink/80 line-clamp-3">
            {body}
          </p>
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-app-bg via-app-bg/85 to-transparent"
            aria-hidden
          />
        </div>
      )}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="mt-1 flex w-full min-h-11 items-center justify-center rounded-md border border-transparent text-app-muted transition hover:border-app-border/60 hover:bg-app-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
      >
        <IconChevronDown
          className={`h-5 w-5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
        <span className="sr-only">
          {expanded ? 'Collapse observation note' : 'Expand observation note'}
        </span>
      </button>
    </div>
  );
}
