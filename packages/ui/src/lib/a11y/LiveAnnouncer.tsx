'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { AnnounceOptions, AnnouncePoliteness } from './types.js';

const VISUALLY_HIDDEN: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

type LiveMessage = {
  text: string;
  seq: number;
};

export type AnnounceContextValue = {
  /**
   * Queues text for screen readers via ARIA live regions (polite or assertive).
   *
   * @param message - Plain-language message; empty strings are ignored.
   * @param options - Optional `politeness` (default `polite`).
   */
  announce: (message: string, options?: AnnounceOptions) => void;
};

const AnnounceContext = createContext<AnnounceContextValue | null>(null);

/**
 * Provides two visually hidden live regions (`status` + `alert`) for screen reader
 * announcements in browser environments (Next.js user/practitioner web apps).
 * Mount once near the document root; use {@link useAnnounce} in client components.
 *
 * @param props - React children to wrap.
 * @returns Provider with polite and assertive live regions appended after children.
 */
export function LiveAnnouncerProvider({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState<LiveMessage>({ text: '', seq: 0 });
  const [assertive, setAssertive] = useState<LiveMessage>({ text: '', seq: 0 });

  const announce = useCallback((message: string, options?: AnnounceOptions) => {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }
    const politeness: AnnouncePoliteness = options?.politeness ?? 'polite';
    if (politeness === 'assertive') {
      setAssertive((prev) => ({ text: trimmed, seq: prev.seq + 1 }));
    } else {
      setPolite((prev) => ({ text: trimmed, seq: prev.seq + 1 }));
    }
  }, []);

  const value = useMemo(() => ({ announce }), [announce]);

  return (
    <AnnounceContext.Provider value={value}>
      {children}
      <div
        key={`polite-${polite.seq}`}
        aria-live="polite"
        aria-relevant="additions text"
        aria-atomic="true"
        role="status"
        style={VISUALLY_HIDDEN}
      >
        {polite.text}
      </div>
      <div
        key={`assertive-${assertive.seq}`}
        aria-live="assertive"
        aria-atomic="true"
        role="alert"
        style={VISUALLY_HIDDEN}
      >
        {assertive.text}
      </div>
    </AnnounceContext.Provider>
  );
}

/**
 * Returns the announce function from the nearest {@link LiveAnnouncerProvider}.
 *
 * @returns Context value with `announce`.
 * @throws Error if used outside {@link LiveAnnouncerProvider}.
 */
export function useAnnounce(): AnnounceContextValue {
  const ctx = useContext(AnnounceContext);
  if (!ctx) {
    throw new Error(
      'useAnnounce must be used within a LiveAnnouncerProvider. Wrap the app root (see docs/A11Y.md).',
    );
  }
  return ctx;
}
