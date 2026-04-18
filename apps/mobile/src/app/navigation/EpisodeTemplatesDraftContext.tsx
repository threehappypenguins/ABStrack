import React, { createContext, useContext, useEffect, useRef } from 'react';

export type EpisodeTemplatesDraftSnapshot = {
  isDirty: boolean;
  busy: boolean;
  navigateToList: () => void;
};

const EpisodeTemplatesDraftRefContext =
  createContext<React.MutableRefObject<EpisodeTemplatesDraftSnapshot | null> | null>(
    null,
  );

/**
 * Wraps the main tab navigator; create/edit screens register draft state so the tab bar can
 * intercept leaving the Templates tab.
 */
export function EpisodeTemplatesDraftProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const draftRef = useRef<EpisodeTemplatesDraftSnapshot | null>(null);
  return (
    <EpisodeTemplatesDraftRefContext.Provider value={draftRef}>
      {children}
    </EpisodeTemplatesDraftRefContext.Provider>
  );
}

/**
 * Registers unsaved-episode-template draft state while create or edit is active.
 *
 * @param active - When false, unregisters (e.g. editor still loading).
 * @param isDirty - Whether the form has unsaved edits.
 * @param busy - Save/delete in flight; blocks leaving.
 * @param navigateToList - Pushes nested stack to `EpisodeTemplateList`.
 */
export function useEpisodeTemplatesDraftRegistration(
  active: boolean,
  isDirty: boolean,
  busy: boolean,
  navigateToList: () => void,
): void {
  const ref = useContext(EpisodeTemplatesDraftRefContext);
  if (!ref) {
    throw new Error(
      'useEpisodeTemplatesDraftRegistration must be used under EpisodeTemplatesDraftProvider.',
    );
  }
  useEffect(() => {
    if (!active) {
      ref.current = null;
      return undefined;
    }
    ref.current = { isDirty, busy, navigateToList };
    return () => {
      ref.current = null;
    };
  }, [active, ref, isDirty, busy, navigateToList]);
}

export function useEpisodeTemplatesDraftRef(): React.MutableRefObject<EpisodeTemplatesDraftSnapshot | null> {
  const ref = useContext(EpisodeTemplatesDraftRefContext);
  if (!ref) {
    throw new Error(
      'useEpisodeTemplatesDraftRef must be used under EpisodeTemplatesDraftProvider.',
    );
  }
  return ref;
}
