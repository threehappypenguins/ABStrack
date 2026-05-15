'use client';

import {
  formatPractitionerPatientDirectoryLabel,
  loadPractitionerPatientObservationReadModel,
  PRACTITIONER_PATIENT_EPISODE_HISTORY_CAP,
  type EpisodeTimelineItem,
  type PractitionerPatientEpisodeRow,
  type PractitionerPatientObservationReadModel,
} from '@abstrack/supabase';
import { getSupabaseBrowserClient } from '@abstrack/supabase/browser';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';

type PatientDetailLoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; model: PractitionerPatientObservationReadModel }
  | { kind: 'error'; message: string };

type PractitionerPatientDetailPageProps = {
  /** Patient `auth.users.id` (dynamic route segment). */
  patientUserId: string;
};

function formatObservationTimestamp(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    return iso;
  }
  return new Date(t).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function observationKindNoun(kind: EpisodeTimelineItem['kind']): string {
  if (kind === 'symptom') {
    return 'Symptom';
  }
  if (kind === 'health_marker') {
    return 'Health marker';
  }
  return 'Food diary';
}

function episodeSummaryHeading(episode: PractitionerPatientEpisodeRow): string {
  const start = formatObservationTimestamp(episode.started_at);
  if (episode.ended_at) {
    const end = formatObservationTimestamp(episode.ended_at);
    return `${episode.episode_type} episode · ${start} – ${end}`;
  }
  return `${episode.episode_type} episode · ${start} · Ongoing`;
}

/**
 * Per-patient practitioner read-only view: time-ordered episode-bound observations (symptoms, health
 * markers, episode-tied food) plus standalone markers and food diary (PRD §8; no writes to PHI).
 *
 * @param props - Patient user id from the route.
 * @returns Patient detail UI with loading, error, and empty states.
 */
export function PractitionerPatientDetailPage({
  patientUserId,
}: PractitionerPatientDetailPageProps) {
  const { announce } = useAnnounce();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const pageId = useId();
  const episodeRegionPrefix = `${pageId}-episode`;

  const [loadState, setLoadState] = useState<PatientDetailLoadState>({
    kind: 'loading',
  });

  const load = useCallback(async () => {
    setLoadState({ kind: 'loading' });
    const result = await loadPractitionerPatientObservationReadModel(
      supabase,
      patientUserId,
    );
    if (!result.ok) {
      const message = result.error.message;
      setLoadState({ kind: 'error', message });
      announce(message, { politeness: 'assertive' });
      return;
    }

    setLoadState({ kind: 'ready', model: result.data });
    const epCount = result.data.episodesWithTimelines.length;
    const standCount = result.data.standaloneTimeline.length;
    announce(
      `Patient record loaded. ${epCount} ${epCount === 1 ? 'episode' : 'episodes'}. ${standCount} standalone ${standCount === 1 ? 'entry' : 'entries'}.`,
      { politeness: 'polite' },
    );
  }, [announce, patientUserId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const title = useMemo(() => {
    if (loadState.kind !== 'ready') {
      return formatPractitionerPatientDirectoryLabel(patientUserId, null);
    }
    return formatPractitionerPatientDirectoryLabel(
      patientUserId,
      loadState.model.patientDisplayName,
    );
  }, [loadState, patientUserId]);

  const isLoading = loadState.kind === 'loading';
  const errorMessage = loadState.kind === 'error' ? loadState.message : null;
  const model = loadState.kind === 'ready' ? loadState.model : null;

  return (
    <div
      id="practitioner-patient-detail"
      className="mx-auto max-w-3xl px-4 py-8 sm:px-6"
    >
      <div className="mb-6">
        <Link
          href="/patients"
          className="inline-flex min-h-11 items-center text-sm font-medium text-app-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
        >
          Back to patients
        </Link>
      </div>

      <header className="border-b border-app-border pb-6">
        <h1 className="text-2xl font-semibold text-app-ink">{title}</h1>
        <p className="mt-2 font-mono text-xs text-app-muted">{patientUserId}</p>
        <p className="mt-3 text-sm text-app-muted">
          Read-only timeline: episode symptoms, health markers, and food logged
          during episodes, then standalone markers and food outside episodes.
        </p>
      </header>

      {isLoading ? (
        <p
          className="mt-8 text-sm text-app-muted"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          Loading patient record…
        </p>
      ) : null}

      {errorMessage ? (
        <div
          className="mt-8 rounded-xl border border-app-border bg-app-surface p-5 shadow-soft"
          role="alert"
        >
          <p className="text-sm text-app-ink">{errorMessage}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md bg-app-primary px-4 py-2 text-sm font-medium text-white transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
          >
            Try again
          </button>
        </div>
      ) : null}

      {model?.moreEpisodesOmitted ? (
        <p className="mt-6 text-sm text-app-muted" role="status">
          Showing the {PRACTITIONER_PATIENT_EPISODE_HISTORY_CAP} most recent
          episodes. Older episodes are not listed here.
        </p>
      ) : null}

      {model &&
      model.episodesWithTimelines.length === 0 &&
      model.standaloneTimeline.length === 0 ? (
        <div
          className="mt-8 rounded-xl border border-dashed border-app-border bg-app-surface/60 p-6"
          role="status"
          aria-labelledby={`${pageId}-empty-heading`}
        >
          <h2
            id={`${pageId}-empty-heading`}
            className="text-lg font-semibold text-app-ink"
          >
            No observations yet
          </h2>
          <p className="mt-2 text-sm text-app-muted">
            This patient has no logged episodes or standalone health markers and
            food diary entries you can view.
          </p>
        </div>
      ) : null}

      {model && model.episodesWithTimelines.length > 0 ? (
        <section
          className="mt-10"
          aria-labelledby={`${pageId}-episodes-heading`}
        >
          <h2
            id={`${pageId}-episodes-heading`}
            className="text-lg font-semibold text-app-ink"
          >
            Episode history
          </h2>
          <p className="mt-2 text-sm text-app-muted">
            Within each episode, observations are oldest first (timestamp, then
            id as tie-breaker).
          </p>
          <div className="mt-6 space-y-8">
            {model.episodesWithTimelines.map(({ episode, timeline }) => {
              const regionId = `${episodeRegionPrefix}-${episode.id}`;
              return (
                <section
                  key={episode.id}
                  className="rounded-xl border border-app-border bg-app-surface p-5 shadow-soft"
                  aria-labelledby={`${regionId}-heading`}
                >
                  <h3
                    id={`${regionId}-heading`}
                    className="text-base font-semibold text-app-ink"
                  >
                    {episodeSummaryHeading(episode)}
                  </h3>
                  {episode.episode_label?.trim() ? (
                    <p className="mt-1 text-sm text-app-muted">
                      {episode.episode_label.trim()}
                    </p>
                  ) : null}
                  {timeline.length === 0 ? (
                    <p className="mt-4 text-sm text-app-muted" role="status">
                      No observations recorded for this episode.
                    </p>
                  ) : (
                    <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm text-app-ink">
                      {timeline.map((row) => {
                        const time = formatObservationTimestamp(row.sortAt);
                        const kind = observationKindNoun(row.kind);
                        const ann = `${kind} at ${time}. ${row.label}. ${row.detail}.`;
                        return (
                          <li
                            key={`${row.kind}-${row.id}`}
                            className="pl-1"
                            aria-label={ann}
                          >
                            <span className="block text-xs font-medium uppercase tracking-wide text-app-muted">
                              {kind} · {time}
                            </span>
                            <span className="mt-0.5 block font-medium">
                              {row.label}
                            </span>
                            <span className="mt-0.5 block text-app-muted">
                              {row.detail}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </section>
              );
            })}
          </div>
        </section>
      ) : null}

      {model && model.standaloneTimeline.length > 0 ? (
        <section
          className="mt-10"
          aria-labelledby={`${pageId}-standalone-heading`}
        >
          <h2
            id={`${pageId}-standalone-heading`}
            className="text-lg font-semibold text-app-ink"
          >
            Standalone health markers &amp; food diary
          </h2>
          <p className="mt-2 text-sm text-app-muted">
            Entries logged outside any episode (not tied to a flare record),
            oldest first.
          </p>
          <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm text-app-ink">
            {model.standaloneTimeline.map((row) => {
              const time = formatObservationTimestamp(row.sortAt);
              const kind = observationKindNoun(row.kind);
              const ann = `${kind} at ${time}. ${row.label}. ${row.detail}.`;
              return (
                <li
                  key={`standalone-${row.kind}-${row.id}`}
                  className="pl-1"
                  aria-label={ann}
                >
                  <span className="block text-xs font-medium uppercase tracking-wide text-app-muted">
                    {kind} · {time}
                  </span>
                  <span className="mt-0.5 block font-medium">{row.label}</span>
                  <span className="mt-0.5 block text-app-muted">
                    {row.detail}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {model &&
      model.standaloneTimeline.length === 0 &&
      model.episodesWithTimelines.length > 0 ? (
        <div
          className="mt-10 rounded-xl border border-dashed border-app-border bg-app-surface/60 p-6"
          role="status"
          aria-labelledby={`${pageId}-standalone-empty-heading`}
        >
          <h2
            id={`${pageId}-standalone-empty-heading`}
            className="text-lg font-semibold text-app-ink"
          >
            No standalone markers or food entries
          </h2>
          <p className="mt-2 text-sm text-app-muted">
            This patient has not logged health markers or food outside of an
            episode, or none are in the recent window shown here.
          </p>
        </div>
      ) : null}
    </div>
  );
}
