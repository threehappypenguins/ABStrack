'use client';

import {
  createPractitionerObservationNote,
  deletePractitionerObservationNote,
  PRACTITIONER_OBSERVATION_NOTE_BODY_MAX_LENGTH,
  updatePractitionerObservationNote,
  type AbstrackSupabaseClient,
  type PractitionerObservationNoteRow,
} from '@abstrack/supabase';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { useCallback, useId, useState, type FormEvent } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { IconPencil } from './IconPencil';
import { IconTrash } from './IconTrash';
import { PractitionerObservationNoteContent } from './practitioner-observation-note-content';

function formatNoteTimestamp(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    return iso;
  }
  return new Date(t).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

type PractitionerObservationNotesPanelProps = {
  supabase: AbstrackSupabaseClient;
  patientUserId: string;
  practitionerUserId: string;
  /** When set, notes are scoped to this episode; otherwise patient-record notes. */
  episodeId?: string | null;
  notes: PractitionerObservationNoteRow[];
  onNotesChange: (notes: PractitionerObservationNoteRow[]) => void;
  /** Section heading element id for `aria-labelledby`. */
  headingId: string;
  heading: string;
  description: string;
  emptyListMessage: string;
  composeSubmitLabel: string;
};

/**
 * Accessible list + compose/edit UI for practitioner observation notes (PRD §8).
 * Practitioners may add, edit, and delete their own rows; RLS enforces grant access on writes.
 */
export function PractitionerObservationNotesPanel({
  supabase,
  patientUserId,
  practitionerUserId,
  episodeId = null,
  notes,
  onNotesChange,
  headingId,
  heading,
  description,
  emptyListMessage,
  composeSubmitLabel,
}: PractitionerObservationNotesPanelProps) {
  const { announce } = useAnnounce();
  const formId = useId();
  const bodyFieldId = `${formId}-body`;
  const errorId = `${formId}-error`;
  const hintId = `${formId}-hint`;

  const [composeOpen, setComposeOpen] = useState(false);
  const [composeBody, setComposeBody] = useState('');
  const [composeSubmitting, setComposeSubmitting] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [discardComposeOpen, setDiscardComposeOpen] = useState(false);

  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] =
    useState<PractitionerObservationNoteRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const scopedNotes = notes.filter((note) =>
    episodeId == null ? note.episodeId == null : note.episodeId === episodeId,
  );

  const mergeNote = useCallback(
    (saved: PractitionerObservationNoteRow) => {
      const without = notes.filter((n) => n.id !== saved.id);
      const next = [saved, ...without].sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      );
      onNotesChange(next);
    },
    [notes, onNotesChange],
  );

  const removeNote = useCallback(
    (noteId: string) => {
      onNotesChange(notes.filter((n) => n.id !== noteId));
    },
    [notes, onNotesChange],
  );

  const onCompose = async (e: FormEvent) => {
    e.preventDefault();
    setComposeSubmitting(true);
    setComposeError(null);
    const result = await createPractitionerObservationNote(supabase, {
      patientUserId,
      practitionerUserId,
      episodeId,
      body: composeBody,
    });
    setComposeSubmitting(false);
    if (!result.ok) {
      setComposeError(result.error.message);
      announce(result.error.message, { politeness: 'assertive' });
      return;
    }
    mergeNote(result.data);
    setComposeBody('');
    setComposeOpen(false);
    announce('Observation note saved.', { politeness: 'polite' });
  };

  const cancelCompose = () => {
    setComposeOpen(false);
    setComposeBody('');
    setComposeError(null);
    setDiscardComposeOpen(false);
  };

  const requestCancelCompose = () => {
    if (composeBody.trim().length > 0) {
      setDiscardComposeOpen(true);
      return;
    }
    cancelCompose();
  };

  const startEdit = (note: PractitionerObservationNoteRow) => {
    setEditingNoteId(note.id);
    setEditBody(note.body);
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingNoteId(null);
    setEditBody('');
    setEditError(null);
  };

  const onSaveEdit = async (noteId: string) => {
    setEditSubmitting(true);
    setEditError(null);
    const result = await updatePractitionerObservationNote(supabase, {
      noteId,
      body: editBody,
    });
    setEditSubmitting(false);
    if (!result.ok) {
      setEditError(result.error.message);
      announce(result.error.message, { politeness: 'assertive' });
      return;
    }
    mergeNote(result.data);
    setEditingNoteId(null);
    setEditBody('');
    announce('Observation note updated.', { politeness: 'polite' });
  };

  const handleDeleteConfirm = async (): Promise<void | false> => {
    if (!deleteTarget) {
      return false;
    }
    setDeleteError(null);
    const result = await deletePractitionerObservationNote(
      supabase,
      deleteTarget.id,
    );
    if (!result.ok) {
      setDeleteError(result.error.message);
      announce(result.error.message, { politeness: 'assertive' });
      return false;
    }
    removeNote(deleteTarget.id);
    announce('Observation note deleted.', { politeness: 'polite' });
    return undefined;
  };

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <h3 id={headingId} className="text-base font-semibold text-app-ink">
        {heading}
      </h3>
      <p className="mt-1 text-sm text-app-muted">{description}</p>

      <div className="mt-4">
        {!composeOpen ? (
          <button
            type="button"
            onClick={() => {
              setComposeError(null);
              setComposeOpen(true);
            }}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-app-border bg-app-surface px-4 py-2 text-sm font-semibold text-app-primary shadow-soft transition hover:bg-app-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
          >
            Add observation note
          </button>
        ) : (
          <form
            className="rounded-lg border border-app-border bg-app-surface/80 p-4 shadow-soft"
            onSubmit={(ev) => void onCompose(ev)}
            aria-labelledby={`${formId}-compose-heading`}
          >
            <h4
              id={`${formId}-compose-heading`}
              className="text-sm font-semibold text-app-ink"
            >
              Add observation note
            </h4>
            <label
              htmlFor={bodyFieldId}
              className="mt-3 block text-sm font-medium text-app-ink"
            >
              Note
            </label>
            <textarea
              id={bodyFieldId}
              name="body"
              value={composeBody}
              onChange={(ev) => setComposeBody(ev.target.value)}
              rows={4}
              maxLength={PRACTITIONER_OBSERVATION_NOTE_BODY_MAX_LENGTH}
              disabled={composeSubmitting}
              aria-describedby={`${hintId}${composeError ? ` ${errorId}` : ''}`}
              aria-invalid={composeError ? 'true' : undefined}
              className="mt-1.5 min-h-[7rem] w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
            />
            <p id={hintId} className="mt-1.5 text-xs text-app-muted">
              Up to{' '}
              {PRACTITIONER_OBSERVATION_NOTE_BODY_MAX_LENGTH.toLocaleString()}{' '}
              characters. Only you can edit or delete notes you author.
            </p>
            {composeError ? (
              <p
                id={errorId}
                className="mt-2 text-sm text-app-ink"
                role="alert"
              >
                {composeError}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={composeSubmitting}
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-app-primary px-4 py-2 text-sm font-medium text-white transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:opacity-60"
              >
                {composeSubmitting ? 'Saving…' : composeSubmitLabel}
              </button>
              <button
                type="button"
                disabled={composeSubmitting}
                onClick={requestCancelCompose}
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-app-border bg-app-surface px-4 py-2 text-sm font-medium text-app-ink transition hover:bg-app-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {scopedNotes.length === 0 ? (
        <p className="mt-4 text-sm text-app-muted" role="status">
          {emptyListMessage}
        </p>
      ) : (
        <ul
          role="list"
          className="mt-4 w-full list-none space-y-4 p-0"
          aria-label={`${heading} list`}
        >
          {scopedNotes.map((note) => {
            const isOwn = note.practitionerUserId === practitionerUserId;
            const created = formatNoteTimestamp(note.createdAt);
            const updated =
              note.updatedAt !== note.createdAt
                ? formatNoteTimestamp(note.updatedAt)
                : null;
            const isEditing = editingNoteId === note.id;

            return (
              <li
                key={note.id}
                className="rounded-lg border border-app-border/80 bg-app-bg/40 px-4 py-3"
                aria-label={`Observation note from ${created}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-app-muted">
                    {created}
                    {updated ? ` · Updated ${updated}` : null}
                  </p>
                  {isOwn && !isEditing ? (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => startEdit(note)}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-app-muted transition hover:bg-app-muted/15 hover:text-app-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
                        aria-label="Edit observation note"
                      >
                        <IconPencil className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteTarget(note);
                        }}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-app-muted transition hover:bg-app-muted/15 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:hover:text-red-400"
                        aria-label="Delete observation note"
                      >
                        <IconTrash className="h-5 w-5" />
                      </button>
                    </div>
                  ) : null}
                </div>

                {isEditing ? (
                  <form
                    className="mt-3"
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      void onSaveEdit(note.id);
                    }}
                    aria-label="Edit observation note"
                  >
                    <label
                      htmlFor={`${formId}-edit-${note.id}`}
                      className="sr-only"
                    >
                      Observation note text
                    </label>
                    <textarea
                      id={`${formId}-edit-${note.id}`}
                      value={editBody}
                      onChange={(ev) => setEditBody(ev.target.value)}
                      rows={4}
                      maxLength={PRACTITIONER_OBSERVATION_NOTE_BODY_MAX_LENGTH}
                      disabled={editSubmitting}
                      className="min-h-[7rem] w-full rounded-md border border-app-border bg-app-surface px-3 py-2 text-sm text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
                    />
                    {editError ? (
                      <p
                        id={`${formId}-edit-error-${note.id}`}
                        className="mt-2 text-sm text-app-ink"
                        role="alert"
                      >
                        {editError}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-3">
                      <button
                        type="submit"
                        disabled={editSubmitting}
                        className="inline-flex min-h-11 items-center justify-center rounded-md bg-app-primary px-4 py-2 text-sm font-medium text-white transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:opacity-60"
                      >
                        {editSubmitting ? 'Saving…' : 'Save changes'}
                      </button>
                      <button
                        type="button"
                        disabled={editSubmitting}
                        onClick={cancelEdit}
                        className="inline-flex min-h-11 items-center justify-center rounded-md border border-app-border bg-app-surface px-4 py-2 text-sm font-medium text-app-ink transition hover:bg-app-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <PractitionerObservationNoteContent body={note.body} />
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={discardComposeOpen}
        title="Discard this note?"
        description="You have unsaved text. If you continue, your draft will be lost."
        confirmLabel="Discard draft"
        onConfirm={() => {
          cancelCompose();
          return undefined;
        }}
        onClose={() => {
          setDiscardComposeOpen(false);
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this observation note?"
        description="This cannot be undone. The patient will no longer see this note."
        confirmLabel="Delete note"
        confirmBusyLabel="Deleting…"
        onConfirm={() => handleDeleteConfirm()}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
      >
        {deleteError ? (
          <p className="text-sm text-app-ink" role="alert">
            {deleteError}
          </p>
        ) : null}
      </ConfirmDialog>
    </section>
  );
}
