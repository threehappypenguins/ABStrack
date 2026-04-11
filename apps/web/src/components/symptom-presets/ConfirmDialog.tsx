'use client';

import { useEffect, useId, useRef } from 'react';

export type ConfirmDialogProps = {
  /** When true, the native dialog is shown modally. */
  open: boolean;
  /** Dialog title (visible and referenced by `aria-labelledby`). */
  title: string;
  /** Optional supporting text below the title. */
  description?: string;
  /** Label for the destructive or primary confirm control. */
  confirmLabel: string;
  /** Label for dismiss (default: Cancel). */
  cancelLabel?: string;
  /**
   * Called when the user confirms. If this returns `false`, the dialog stays open
   * (e.g. the action failed and the user should retry or cancel).
   */
  onConfirm: () => void | false | Promise<void | false>;
  /** Called when the dialog closes without confirming (cancel, Escape, backdrop). */
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
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    if (open) {
      el.showModal();
    } else {
      el.close();
    }
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
      onCancel={(event) => {
        event.preventDefault();
        ref.current?.close();
      }}
    >
      <div className="space-y-4">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {description ? (
          <p className="text-sm text-app-muted">{description}</p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-3">
          <button
            type="button"
            className="min-h-[44px] rounded-full border border-app-border bg-app-surface px-4 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-[var(--app-nav-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
            onClick={() => {
              ref.current?.close();
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="min-h-[44px] rounded-full bg-red-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:bg-red-700 dark:hover:bg-red-600"
            onClick={() => {
              void (async () => {
                const result = await Promise.resolve(onConfirm());
                if (result === false) {
                  return;
                }
                ref.current?.close();
              })();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
