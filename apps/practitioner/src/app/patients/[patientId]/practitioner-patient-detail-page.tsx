'use client';

import {
  EPISODE_TIMELINE_SOURCE_LIMIT,
  formatPractitionerPatientDirectoryLabel,
  loadPractitionerPatientObservationReadModel,
  PRACTITIONER_PATIENT_EPISODE_HISTORY_CAP,
  PRACTITIONER_STANDALONE_OBSERVATION_CAP,
  type EpisodeTimelineItem,
  type PractitionerPatientEpisodeRow,
  type PractitionerPatientObservationReadModel,
} from '@abstrack/supabase';
import { getSupabaseBrowserClient } from '@abstrack/supabase/browser';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

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

/** Above this length, practitioner timeline rows clamp visually when there is no separate full-detail field. */
const PRACTITIONER_TIMELINE_DETAIL_EXPAND_THRESHOLD = 160;

/**
 * Renders timeline observation detail: compact inline preview; native disclosure when full text is split out or very long.
 * Closed-state **Show full note** / open-state **Collapse full note** labels supplement the hidden twistie so keyboard and screen-reader users see an explicit expand affordance.
 *
 * @param props.detail - Bounded preview (`EpisodeTimelineItem.detail`).
 * @param props.detailFull - Full note when present (`EpisodeTimelineItem.detailFull`).
 */
function PractitionerTimelineObservationDetail({
  detail,
  detailFull,
}: {
  detail: string;
  detailFull?: string;
}) {
  const fullText = detailFull ?? detail;
  const trimmedPreview = detail.trim();
  const needsExpand =
    detailFull != null ||
    (trimmedPreview.length > PRACTITIONER_TIMELINE_DETAIL_EXPAND_THRESHOLD &&
      trimmedPreview !== '—');

  if (!needsExpand) {
    return (
      <span className="mt-0.5 block whitespace-pre-wrap break-words text-app-muted">
        {detail || '—'}
      </span>
    );
  }

  return (
    <details className="group mt-0.5">
      <summary className="min-h-11 cursor-pointer list-none rounded-md py-2 text-left [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg">
        <span className="block break-words whitespace-pre-wrap text-app-muted group-open:hidden line-clamp-3">
          {detail}
        </span>
        <span className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-app-primary underline underline-offset-4 group-open:hidden">
          Show full note
        </span>
        <span className="mt-2 hidden min-h-11 items-center text-sm font-semibold text-app-primary underline underline-offset-4 group-open:inline-flex">
          Collapse full note
        </span>
      </summary>
      <div className="mt-2 border-l-2 border-app-border pl-3">
        <p className="break-words whitespace-pre-wrap text-app-muted">
          {fullText}
        </p>
      </div>
    </details>
  );
}

function episodeSummaryHeading(episode: PractitionerPatientEpisodeRow): string {
  const start = formatObservationTimestamp(episode.started_at);
  if (episode.ended_at) {
    const end = formatObservationTimestamp(episode.ended_at);
    return `${episode.episode_type} episode · ${start} – ${end}`;
  }
  return `${episode.episode_type} episode · ${start} · Ongoing`;
}

function EpisodeObservationTruncationNotice({
  moreSymptomsOmitted,
  moreHealthMarkersOmitted,
  moreFoodDiaryOmitted,
  streamCap,
}: {
  moreSymptomsOmitted: boolean;
  moreHealthMarkersOmitted: boolean;
  moreFoodDiaryOmitted: boolean;
  streamCap: number;
}) {
  if (
    !moreSymptomsOmitted &&
    !moreHealthMarkersOmitted &&
    !moreFoodDiaryOmitted
  ) {
    return null;
  }

  return (
    <div
      className="mt-3 rounded-lg border border-app-border/80 bg-app-bg/40 px-3 py-2 text-sm text-app-muted"
      role="status"
    >
      <p className="font-medium text-app-ink">Incomplete episode timeline</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {moreSymptomsOmitted ? (
          <li>
            Symptoms: only the {streamCap} most recent observations are shown;
            older symptom rows exist but are not listed.
          </li>
        ) : null}
        {moreHealthMarkersOmitted ? (
          <li>
            Health markers: only the {streamCap} most recent episode-bound
            entries are shown; older marker rows exist but are not listed.
          </li>
        ) : null}
        {moreFoodDiaryOmitted ? (
          <li>
            Food diary: only the {streamCap} most recent episode-tied meals are
            shown; older food entries exist but are not listed.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/** Standalone timeline rows above this: section starts collapsed and list mounts on expand. */
const PRACTITIONER_STANDALONE_TIMELINE_LAZY_THRESHOLD = 40;

function PractitionerObservationTimelineList({
  rows,
  rowKeyPrefix,
}: {
  rows: EpisodeTimelineItem[];
  rowKeyPrefix: string;
}) {
  return (
    <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm text-app-ink">
      {rows.map((row) => {
        const time = formatObservationTimestamp(row.sortAt);
        const kind = observationKindNoun(row.kind);
        const fullDetail = row.detailFull ?? row.detail;
        const ann = `${kind} at ${time}. ${row.label}. ${fullDetail}.`;
        return (
          <li
            key={`${rowKeyPrefix}-${row.kind}-${row.id}`}
            className="pl-1"
            aria-label={ann}
          >
            <span className="block text-xs font-medium uppercase tracking-wide text-app-muted">
              {kind} · {time}
            </span>
            <span className="mt-0.5 block font-medium">{row.label}</span>
            <PractitionerTimelineObservationDetail
              detail={row.detail}
              detailFull={row.detailFull}
            />
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One episode card: collapsible shell so observation rows mount only after expand (except index 0,
 * open by default). Avoids rendering tens of thousands of DOM nodes when many capped episodes load.
 *
 * @param props.episodeIndex - `0` is the newest episode and stays expanded initially with its timeline mounted.
 */
function PractitionerEpisodeTimelineCard({
  episode,
  timeline,
  moreSymptomsOmitted,
  moreHealthMarkersOmitted,
  moreFoodDiaryOmitted,
  episodeIndex,
  regionId,
}: {
  episode: PractitionerPatientEpisodeRow;
  timeline: EpisodeTimelineItem[];
  moreSymptomsOmitted: boolean;
  moreHealthMarkersOmitted: boolean;
  moreFoodDiaryOmitted: boolean;
  episodeIndex: number;
  regionId: string;
}) {
  const defaultOpen = episodeIndex === 0;
  const hasObservations = timeline.length > 0;
  const [listMounted, setListMounted] = useState(
    defaultOpen || !hasObservations,
  );
  const [expanded, setExpanded] = useState(defaultOpen);

  const anyStreamTruncated =
    moreSymptomsOmitted || moreHealthMarkersOmitted || moreFoodDiaryOmitted;

  const observationSummary =
    timeline.length === 0
      ? 'No observations in loaded window'
      : `${timeline.length} observation${timeline.length === 1 ? '' : 's'} in loaded window`;

  return (
    <details
      className="rounded-xl border border-app-border bg-app-surface p-5 shadow-soft"
      aria-labelledby={`${regionId}-heading`}
      open={expanded}
      onToggle={(e) => {
        const nextOpen = e.currentTarget.open;
        setExpanded(nextOpen);
        if (nextOpen) {
          setListMounted(true);
        }
      }}
    >
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg">
        <span
          id={`${regionId}-heading`}
          className="text-base font-semibold text-app-ink"
        >
          {episodeSummaryHeading(episode)}
        </span>
        <span className="mt-1 block text-sm text-app-muted">
          {observationSummary}
        </span>
        {anyStreamTruncated ? (
          <span className="mt-1 block text-xs text-app-muted">
            Loaded streams may omit older rows (cap{' '}
            {EPISODE_TIMELINE_SOURCE_LIMIT} per type).
          </span>
        ) : null}
        <span className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-app-primary underline underline-offset-4">
          {expanded ? 'Hide episode timeline' : 'Show episode timeline'}
        </span>
      </summary>

      <div className="mt-4 border-t border-app-border pt-4">
        {episode.episode_label?.trim() ? (
          <p className="text-sm text-app-muted">
            {episode.episode_label.trim()}
          </p>
        ) : null}
        <EpisodeObservationTruncationNotice
          moreSymptomsOmitted={moreSymptomsOmitted}
          moreHealthMarkersOmitted={moreHealthMarkersOmitted}
          moreFoodDiaryOmitted={moreFoodDiaryOmitted}
          streamCap={EPISODE_TIMELINE_SOURCE_LIMIT}
        />
        {listMounted ? (
          hasObservations ? (
            <PractitionerObservationTimelineList
              rows={timeline}
              rowKeyPrefix={`${episode.id}`}
            />
          ) : (
            <p className="mt-4 text-sm text-app-muted" role="status">
              No observations recorded for this episode.
            </p>
          )
        ) : (
          <p className="sr-only">
            Expand “Show episode timeline” to load observations for this
            episode.
          </p>
        )}
      </div>
    </details>
  );
}

/**
 * Standalone markers + food list; lazy-mount when row count exceeds
 * {@link PRACTITIONER_STANDALONE_TIMELINE_LAZY_THRESHOLD} to limit initial DOM size.
 *
 * The patient detail page mounts this with `key={patientUserId}` so client navigations between
 * patients reset lazy/collapsed state instead of reusing the previous patient's disclosure state.
 *
 * @param props.ariaLabelledBy - Id of the surrounding section heading (`<h2>`) used for `aria-labelledby`.
 */
function PractitionerStandaloneTimelineSection({
  standaloneTimeline,
  markersTruncated,
  foodTruncated,
  ariaLabelledBy,
}: {
  standaloneTimeline: EpisodeTimelineItem[];
  markersTruncated: boolean;
  foodTruncated: boolean;
  /** Section heading element id (e.g. standalone `<h2>`) so the disclosure shares one landmark label. */
  ariaLabelledBy: string;
}) {
  const n = standaloneTimeline.length;
  const startCollapsed = n > PRACTITIONER_STANDALONE_TIMELINE_LAZY_THRESHOLD;
  const [listMounted, setListMounted] = useState(!startCollapsed);
  const [expanded, setExpanded] = useState(!startCollapsed);

  const observationSummary =
    n === 0
      ? 'No standalone entries'
      : `${n} standalone ${n === 1 ? 'entry' : 'entries'} in loaded window`;

  return (
    <details
      className="rounded-xl border border-app-border bg-app-surface p-5 shadow-soft"
      aria-labelledby={ariaLabelledBy}
      open={expanded}
      onToggle={(e) => {
        const nextOpen = e.currentTarget.open;
        setExpanded(nextOpen);
        if (nextOpen) {
          setListMounted(true);
        }
      }}
    >
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg">
        <span className="text-base font-semibold text-app-ink">
          Observation list
        </span>
        <span className="mt-1 block text-sm text-app-muted">
          {observationSummary}
        </span>
        {markersTruncated || foodTruncated ? (
          <span className="mt-1 block text-xs text-app-muted">
            Loaded standalone streams may omit older rows (cap{' '}
            {PRACTITIONER_STANDALONE_OBSERVATION_CAP} per type).
          </span>
        ) : null}
        <span className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-app-primary underline underline-offset-4">
          {expanded ? 'Hide standalone entries' : 'Show standalone entries'}
        </span>
      </summary>

      <div className="mt-4 border-t border-app-border pt-4">
        <StandaloneObservationTruncationNotice
          markersTruncated={markersTruncated}
          foodTruncated={foodTruncated}
          cap={PRACTITIONER_STANDALONE_OBSERVATION_CAP}
        />
        {listMounted ? (
          <PractitionerObservationTimelineList
            rows={standaloneTimeline}
            rowKeyPrefix="standalone"
          />
        ) : (
          <p className="sr-only">
            Expand “Show standalone entries” to load the standalone observation
            list.
          </p>
        )}
      </div>
    </details>
  );
}

function StandaloneObservationTruncationNotice({
  markersTruncated,
  foodTruncated,
  cap,
}: {
  markersTruncated: boolean;
  foodTruncated: boolean;
  cap: number;
}) {
  if (!markersTruncated && !foodTruncated) {
    return null;
  }

  return (
    <div
      className="mt-4 rounded-lg border border-app-border/80 bg-app-bg/40 px-3 py-2 text-sm text-app-muted"
      role="status"
    >
      <p className="font-medium text-app-ink">Incomplete standalone history</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {markersTruncated ? (
          <li>
            Health markers: showing the {cap} most recent standalone entries;
            older markers are not listed.
          </li>
        ) : null}
        {foodTruncated ? (
          <li>
            Food diary: showing the {cap} most recent standalone entries; older
            entries are not listed.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/**
 * Per-patient practitioner read-only view: time-ordered episode-bound observations (symptoms, health
 * markers, episode-tied food) plus standalone markers and food diary (PRD §8; no writes to PHI).
 *
 * Overlapping async loads (navigating between patients, rapid retries) are ignored once superseded
 * so an older response cannot replace state while the route targets a different `patientUserId`.
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

  /** Monotonic token: bump when a load starts; effect cleanup bumps to drop in-flight work on route change/unmount. */
  const loadRequestTokenRef = useRef(0);
  /** Latest route id for post-await checks (response must match UI target). */
  const patientUserIdRef = useRef(patientUserId);
  patientUserIdRef.current = patientUserId;

  const [loadState, setLoadState] = useState<PatientDetailLoadState>({
    kind: 'loading',
  });

  const load = useCallback(async () => {
    const requestToken = ++loadRequestTokenRef.current;
    setLoadState({ kind: 'loading' });
    const result = await loadPractitionerPatientObservationReadModel(
      supabase,
      patientUserId,
    );

    if (requestToken !== loadRequestTokenRef.current) {
      return;
    }

    if (!result.ok) {
      const message = result.error.message;
      setLoadState({ kind: 'error', message });
      announce(message, { politeness: 'assertive' });
      return;
    }

    if (result.data.patientUserId !== patientUserIdRef.current) {
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
    return () => {
      loadRequestTokenRef.current += 1;
    };
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
            {model.episodesWithTimelines.map(
              (
                {
                  episode,
                  timeline,
                  moreSymptomsOmitted,
                  moreHealthMarkersOmitted,
                  moreFoodDiaryOmitted,
                },
                episodeIndex,
              ) => {
                const regionId = `${episodeRegionPrefix}-${episode.id}`;
                return (
                  <section
                    key={episode.id}
                    aria-labelledby={`${regionId}-heading`}
                  >
                    <PractitionerEpisodeTimelineCard
                      episode={episode}
                      timeline={timeline}
                      moreSymptomsOmitted={moreSymptomsOmitted}
                      moreHealthMarkersOmitted={moreHealthMarkersOmitted}
                      moreFoodDiaryOmitted={moreFoodDiaryOmitted}
                      episodeIndex={episodeIndex}
                      regionId={regionId}
                    />
                  </section>
                );
              },
            )}
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
          <div className="mt-6">
            <PractitionerStandaloneTimelineSection
              key={patientUserId}
              standaloneTimeline={model.standaloneTimeline}
              markersTruncated={model.standaloneHealthMarkersTruncated}
              foodTruncated={model.standaloneFoodDiaryTruncated}
              ariaLabelledBy={`${pageId}-standalone-heading`}
            />
          </div>
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
            episode in the loaded window, or none appear here.
          </p>
        </div>
      ) : null}
    </div>
  );
}
