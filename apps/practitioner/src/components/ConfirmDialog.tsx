'use client';

import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

/**
 * `HTMLDialogElement.close()` / `showModal()` throw `InvalidStateError` if the dialog
 * is already closed / already open (HTML standard).
 */
function setDialogModalOpen(el: HTMLDialogElement, open: boolean): void {
  if (open) {
    if (!el.open) {
      el.showModal();
    }
  } else if (el.open) {
    el.close();
  }
}

function closeDialogIfOpen(el: HTMLDialogElement | null): void {
  if (el?.open) {
    el.close();
  }
}

export type ConfirmDialogProps = {
  /** When true, the native dialog is shown modally. */
  open: boolean;
  /** Dialog title (visible and referenced by `aria-labelledby`). */
  title: string;
  /** Optional supporting text below the title. */
  description?: string;
  /** Optional body below the description (e.g. inline validation or error from {@link onConfirm}). */
  children?: ReactNode;
  /** Label for the destructive or primary confirm control. */
  confirmLabel: string;
  /** Label for dismiss (default: Cancel). */
  cancelLabel?: string;
  /** Shown on the confirm button while {@link onConfirm} is in flight (default: “Please wait…”). */
  confirmBusyLabel?: string;
  /**
   * Called when the user confirms. If this returns `false`, the dialog stays open
   * (e.g. the action failed and the user should retry or cancel).
   */
  onConfirm: () => void | false | Promise<void | false>;
  /**
   * Called whenever the native `<dialog>` fires `close` — after a successful confirm
   * (once `onConfirm` resolves), Cancel, Escape, backdrop click, or when the parent
   * closes it by setting `open` to false.
   */
  onClose: () => void;
};

/**
 * Accessible confirmation modal using the native `<dialog>` element with focus management
 * provided by the user agent.
 *
 * @param props - Dialog copy and handlers.
 * @returns A modal dialog element.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  confirmBusyLabel = 'Please wait…',
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const confirmInFlightRef = useRef(false);
  const titleId = useId();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) {
      confirmInFlightRef.current = false;
      setConfirming(false);
    }
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    setDialogModalOpen(el, open);
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const handleClose = () => {
      onClose();
    };
    el.addEventListener('close', handleClose);
    return () => {
      el.removeEventListener('close', handleClose);
    };
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className="max-w-md rounded-2xl border border-app-border/90 bg-app-surface p-6 text-app-ink shadow-xl backdrop:bg-black/40"
      aria-labelledby={titleId}
      aria-busy={confirming}
      onCancel={(event) => {
        event.preventDefault();
        if (confirming) {
          return;
        }
        closeDialogIfOpen(ref.current);
      }}
    >
      <div className="space-y-4">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {description ? (
          <p className="text-sm text-app-muted">{description}</p>
        ) : null}
        {children}
        <div className="flex flex-wrap justify-end gap-3">
          <button
            type="button"
            disabled={confirming}
            className="min-h-[44px] rounded-full border border-app-border bg-app-surface px-4 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-[var(--app-nav-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              closeDialogIfOpen(ref.current);
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={confirming}
            className="min-h-[44px] rounded-full bg-red-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-70 dark:bg-red-700 dark:hover:bg-red-600"
            onClick={() => {
              void (async () => {
                if (confirmInFlightRef.current) {
                  return;
                }
                confirmInFlightRef.current = true;
                setConfirming(true);
                try {
                  const result = await Promise.resolve(onConfirm());
                  if (result === false) {
                    return;
                  }
                  closeDialogIfOpen(ref.current);
                } finally {
                  confirmInFlightRef.current = false;
                  setConfirming(false);
                }
              })();
            }}
          >
            {confirming ? confirmBusyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
