'use client';

import { useEffect, useLayoutEffect, useState } from 'react';

export type EpisodeLocaleInstantProps = {
  /** `IsoTimestamptz` string. */
  iso: string;
  /** Optional class for the wrapping `time` element. */
  className?: string;
};

/**
 * Deterministic, locale-agnostic text for an instant (UTC wall time). Used for SSR, no-JS, and
 * until localized formatting runs in the browser.
 *
 * @param iso - `IsoTimestamptz` string.
 * @returns Readable UTC string, or `iso` when invalid.
 */
function utcIsoFallbackLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, ' UTC');
}

/**
 * Displays an episode instant in the viewer&apos;s locale and time zone after hydration. Until
 * then, shows a deterministic UTC string so assistive tech and no-JS users still get a
 * meaningful value (not an ellipsis). {@link EpisodeLocaleInstantProps.iso} is exposed on
 * `dateTime` and `title`.
 *
 * @param props - ISO timestamp and optional styling.
 * @returns A `time` element with a localized or fallback label.
 */
export function EpisodeLocaleInstant({
  iso,
  className,
}: EpisodeLocaleInstantProps) {
  const [localeLabel, setLocaleLabel] = useState<string | null>(null);

  useLayoutEffect(() => {
    setLocaleLabel(null);
  }, [iso]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setLocaleLabel(
        new Date(iso).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
      );
    });
    return () => cancelAnimationFrame(id);
  }, [iso]);

  const display = localeLabel ?? utcIsoFallbackLabel(iso);

  return (
    <time className={className} dateTime={iso} title={iso}>
      {display}
    </time>
  );
}
