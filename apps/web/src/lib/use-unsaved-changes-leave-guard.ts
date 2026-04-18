'use client';

import { useEffect, useRef, type MutableRefObject } from 'react';

export type PendingLeaveAction =
  | { kind: 'href'; href: string }
  | { kind: 'form'; form: HTMLFormElement };

export type UseUnsavedChangesLeaveGuardParams = {
  /** When true, leaving the page may discard edits (listeners active). */
  active: boolean;
  /** While true, do not start new intercepts (e.g. save in flight). */
  blockIntercepts?: boolean;
  /** Set when the discard-confirmation dialog is open (skip nested intercepts). */
  dialogOpen: boolean;
  /** Latest pending navigation / form submit if the user confirms discard. */
  pendingLeaveRef: MutableRefObject<PendingLeaveAction | null>;
  /** Called after {@link pendingLeaveRef} is set (caller opens the discard dialog). */
  onRequestDiscard: () => void;
  /**
   * When set, {@link HTMLFormElement} with this `id` is not intercepted (e.g. the save form).
   * If omitted, submit interception is disabled so normal forms are not blocked by mistake.
   */
  exemptFormId?: string;
};

/**
 * Warns before losing in-progress edits: browser tab close/refresh ({@link BeforeUnloadEvent}),
 * same-origin navigations via {@link HTMLAnchorElement}, and {@link HTMLFormElement} submit
 * (e.g. sign-out). Does not intercept {@link KeyboardEvent} modified link opens or programmatic
 * {@link useRouter} calls from non-anchor sources.
 *
 * @param params - Guard configuration and refs shared with the confirmation dialog.
 */
export function useUnsavedChangesLeaveGuard({
  active,
  blockIntercepts = false,
  dialogOpen,
  pendingLeaveRef,
  onRequestDiscard,
  exemptFormId,
}: UseUnsavedChangesLeaveGuardParams): void {
  const dialogOpenRef = useRef(dialogOpen);
  dialogOpenRef.current = dialogOpen;

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [active]);

  useEffect(() => {
    if (!active || blockIntercepts) {
      return undefined;
    }

    const onClickCapture = (event: MouseEvent) => {
      if (dialogOpenRef.current) {
        return;
      }
      if (event.defaultPrevented) {
        return;
      }
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
        return;
      }
      // Only intercept primary-button navigations; aux clicks (e.g. middle = open in new tab) must pass through.
      if (event.button !== 0) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      const rawHref = anchor.getAttribute('href');
      if (rawHref == null || rawHref === '' || rawHref.startsWith('#')) {
        return;
      }
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) {
        return;
      }

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      const next =
        url.origin === window.location.origin
          ? `${url.pathname}${url.search}${url.hash}`
          : url.href;

      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;

      if (url.origin === window.location.origin && next === current) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      pendingLeaveRef.current =
        url.origin === window.location.origin
          ? { kind: 'href', href: next }
          : { kind: 'href', href: url.href };
      onRequestDiscard();
    };

    document.addEventListener('click', onClickCapture, true);
    return () => {
      document.removeEventListener('click', onClickCapture, true);
    };
  }, [active, blockIntercepts, onRequestDiscard, pendingLeaveRef]);

  useEffect(() => {
    if (!active || blockIntercepts || !exemptFormId) {
      return undefined;
    }

    const onSubmitCapture = (event: SubmitEvent) => {
      if (dialogOpenRef.current) {
        return;
      }
      if (!(event.target instanceof HTMLFormElement)) {
        return;
      }
      const form = event.target;
      if (form.id === exemptFormId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      pendingLeaveRef.current = { kind: 'form', form };
      onRequestDiscard();
    };

    document.addEventListener('submit', onSubmitCapture, true);
    return () => {
      document.removeEventListener('submit', onSubmitCapture, true);
    };
  }, [
    active,
    blockIntercepts,
    exemptFormId,
    onRequestDiscard,
    pendingLeaveRef,
  ]);
}
