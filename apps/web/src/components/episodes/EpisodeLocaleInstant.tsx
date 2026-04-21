'use client';

import { useEffect, useState } from 'react';

export type EpisodeLocaleInstantProps = {
  /** `IsoTimestamptz` string. */
  iso: string;
  /** Optional class for the wrapping `time` element. */
  className?: string;
};

/**
 * Displays an episode instant in the viewer&apos;s locale and time zone. Formatting runs after
 * mount so it is not tied to the server&apos;s locale (unlike calling `toLocaleString` in an RSC).
 *
 * @param props - ISO timestamp and optional styling.
 * @returns A `time` element with a localized label.
 */
export function EpisodeLocaleInstant({
  iso,
  className,
}: EpisodeLocaleInstantProps) {
  const [label, setLabel] = useState('');

  useEffect(() => {
    setLabel(
      new Date(iso).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    );
  }, [iso]);

  return (
    <time className={className} dateTime={iso} suppressHydrationWarning>
      {label || '…'}
    </time>
  );
}
