'use client';

import {
  EPISODE_TIMELINE_SOURCE_LIMIT,
  formatPractitionerPatientDirectoryLabel,
  listPractitionerObservationNotesForPatient,
  loadPractitionerPatientObservationReadModel,
  PRACTITIONER_PATIENT_EPISODE_HISTORY_CAP,
  PRACTITIONER_PATIENT_OBSERVATION_GRANT_DENIED_MESSAGE,
  PRACTITIONER_STANDALONE_OBSERVATION_CAP,
  type AbstrackSupabaseClient,
  type EpisodeTimelineItem,
  type PractitionerObservationNoteRow,
  type PractitionerPatientEpisodeRow,
  type PractitionerPatientObservationReadModel,
} from '@abstrack/supabase';
import { getSupabaseBrowserClient } from '@abstrack/supabase/browser';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { DisclosureChevron } from '../../../components/DisclosureChevron';
import { PractitionerObservationNotesPanel } from '../../../components/practitioner-observation-notes-panel';
import {
  PRACTITIONER_DETAILS_SUMMARY_BODY_CLASS,
  PRACTITIONER_DETAILS_SUMMARY_CLASS,
} from '../../../components/practitioner-details-summary-classes';
import { PractitionerSymptomMediaViewer } from '../../../components/practitioner-symptom-media-viewer';
import { useAuth } from '../../../lib/auth-provider';
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
  | { kind: 'error'; patientUserId: string; message: string };

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

/**
 * When the merged timeline shows a photo/video symptom placeholder (`Photo` / `Video`), returns the
 * media kind for {@link PractitionerSymptomMediaViewer}; otherwise `null`.
 */
function symptomMediaKindFromTimelineRow(
  row: EpisodeTimelineItem,
): 'photo' | 'video' | null {
  if (row.kind !== 'symptom') {
    return null;
  }
  if (row.detail === 'Photo') {
    return 'photo';
  }
  if (row.detail === 'Video') {
    return 'video';
  }
  return null;
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
  const [noteOpen, setNoteOpen] = useState(false);
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
    <details open={noteOpen} className="group mt-0.5">
      <summary
        className={`${PRACTITIONER_DETAILS_SUMMARY_CLASS} rounded-md py-2`}
        onClick={(e) => {
          e.preventDefault();
          setNoteOpen((prev) => !prev);
        }}
      >
        <span className={PRACTITIONER_DETAILS_SUMMARY_BODY_CLASS}>
          <span className="block break-words whitespace-pre-wrap text-app-muted group-open:hidden line-clamp-3">
            {detail}
          </span>
          <span className="sr-only group-open:hidden">Show full note</span>
          <span className="sr-only hidden group-open:inline">
            Collapse full note
          </span>
        </span>
        <DisclosureChevron />
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

/**
 * Renders a time-ordered list of observation rows. Each `<li>` uses an `aria-label` built from the
 * **inline preview** (`detail`) only so announcements match the collapsed disclosure surface; when
 * `detailFull` exists, the full note stays inside {@link PractitionerTimelineObservationDetail} until
 * the user expands **Show full note**.
 */
function PractitionerObservationTimelineList({
  rows,
  rowKeyPrefix,
  episodeId,
  supabase,
}: {
  rows: EpisodeTimelineItem[];
  rowKeyPrefix: string;
  /** When set, photo/video symptom rows can load episode media via signed URLs. */
  episodeId?: string;
  supabase?: AbstrackSupabaseClient;
}) {
  return (
    <ul
      role="list"
      className="mt-2 w-full list-none space-y-6 p-0 text-sm text-app-ink"
    >
      {rows.map((row) => {
        const time = formatObservationTimestamp(row.sortAt);
        const kind = observationKindNoun(row.kind);
        const previewDetail = row.detail.trim() ? row.detail : '—';
        const ann = `${kind} at ${time}. ${row.label}. ${previewDetail}.`;
        const mediaKind = symptomMediaKindFromTimelineRow(row);
        return (
          <li
            key={`${rowKeyPrefix}-${row.kind}-${row.id}`}
            role="listitem"
            className="border-l-2 border-app-border pl-4"
            aria-label={ann}
          >
            <span className="block text-xs font-medium uppercase tracking-wide text-app-muted">
              {kind} · {time}
            </span>
            <span className="mt-0.5 block font-medium">{row.label}</span>
            {mediaKind && episodeId && supabase ? (
              <PractitionerSymptomMediaViewer
                supabase={supabase}
                episodeId={episodeId}
                episodeSymptomId={row.id}
                mediaKind={mediaKind}
                symptomLabel={row.label}
              />
            ) : (
              <PractitionerTimelineObservationDetail
                detail={row.detail}
                detailFull={row.detailFull}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One episode card: collapsible shell so observation rows mount only after expand. Avoids rendering
 * tens of thousands of DOM nodes when many capped episodes load.
 */
function PractitionerEpisodeTimelineCard({
  episode,
  timeline,
  moreSymptomsOmitted,
  moreHealthMarkersOmitted,
  moreFoodDiaryOmitted,
  regionId,
  supabase,
  patientUserId,
  practitionerUserId,
  observationNotes,
  onObservationNotesChange,
  observationNotesLoading,
  observationNotesLoadError,
}: {
  episode: PractitionerPatientEpisodeRow;
  timeline: EpisodeTimelineItem[];
  moreSymptomsOmitted: boolean;
  moreHealthMarkersOmitted: boolean;
  moreFoodDiaryOmitted: boolean;
  regionId: string;
  supabase: AbstrackSupabaseClient;
  patientUserId: string;
  practitionerUserId: string;
  observationNotes: PractitionerObservationNoteRow[];
  onObservationNotesChange: (notes: PractitionerObservationNoteRow[]) => void;
  observationNotesLoading: boolean;
  observationNotesLoadError: string | null;
}) {
  const hasObservations = timeline.length > 0;
  const [episodeOpen, setEpisodeOpen] = useState(false);
  const [listMounted, setListMounted] = useState(false);

  const anyStreamTruncated =
    moreSymptomsOmitted || moreHealthMarkersOmitted || moreFoodDiaryOmitted;

  const observationSummary =
    timeline.length === 0
      ? 'No observations in loaded window'
      : `${timeline.length} observation${timeline.length === 1 ? '' : 's'} in loaded window`;

  return (
    <details
      open={episodeOpen}
      className="group w-full rounded-xl border border-app-border bg-app-surface p-5 text-left shadow-soft"
      aria-labelledby={`${regionId}-heading`}
    >
      <summary
        className={PRACTITIONER_DETAILS_SUMMARY_CLASS}
        onClick={(e) => {
          e.preventDefault();
          setEpisodeOpen((prev) => {
            const next = !prev;
            if (next) {
              setListMounted(true);
            }
            return next;
          });
        }}
      >
        <span className={PRACTITIONER_DETAILS_SUMMARY_BODY_CLASS}>
          <span
            id={`${regionId}-heading`}
            className="text-base font-semibold leading-snug text-app-ink"
          >
            {episodeSummaryHeading(episode)}
          </span>
          {episode.episode_label?.trim() ? (
            <span className="text-sm font-medium text-app-muted">
              {episode.episode_label.trim()}
            </span>
          ) : null}
          <span className="block text-sm text-app-muted">
            {observationSummary}
          </span>
          {anyStreamTruncated ? (
            <span className="block text-xs text-app-muted">
              Loaded streams may omit older rows (cap{' '}
              {EPISODE_TIMELINE_SOURCE_LIMIT} per type).
            </span>
          ) : null}
        </span>
        <DisclosureChevron />
      </summary>

      <div className="mt-6 w-full border-t border-app-border pt-6">
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
              episodeId={episode.id}
              supabase={supabase}
            />
          ) : (
            <p className="mt-4 text-sm text-app-muted" role="status">
              No observations recorded for this episode.
            </p>
          )
        ) : (
          <p className="sr-only">
            Expand this episode to load observations and practitioner notes.
          </p>
        )}
        {listMounted && practitionerUserId ? (
          <PractitionerObservationNotesPanel
            supabase={supabase}
            patientUserId={patientUserId}
            practitionerUserId={practitionerUserId}
            episodeId={episode.id}
            notes={observationNotes}
            onNotesChange={onObservationNotesChange}
            notesLoading={observationNotesLoading}
            notesLoadError={observationNotesLoadError}
            headingId={`${regionId}-notes-heading`}
            heading="Practitioner observation notes"
            description="Clinical notes for this episode. Patients can read notes you save; only you can edit your own."
            emptyListMessage="No observation notes for this episode yet."
            composeSubmitLabel="Save episode note"
          />
        ) : null}
      </div>
    </details>
  );
}

/**
 * Standalone markers + food list. Starts **collapsed**; the observation list mounts on first expand
 * to keep initial DOM small for long histories.
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
  const [standaloneOpen, setStandaloneOpen] = useState(false);
  const [listMounted, setListMounted] = useState(false);

  const observationSummary =
    n === 0
      ? 'No standalone entries'
      : `${n} standalone ${n === 1 ? 'entry' : 'entries'} in loaded window`;

  return (
    <details
      open={standaloneOpen}
      className="group w-full rounded-xl border border-app-border bg-app-surface p-5 text-left shadow-soft"
      aria-labelledby={ariaLabelledBy}
    >
      <summary
        className={PRACTITIONER_DETAILS_SUMMARY_CLASS}
        onClick={(e) => {
          e.preventDefault();
          setStandaloneOpen((prev) => {
            const next = !prev;
            if (next) {
              setListMounted(true);
            }
            return next;
          });
        }}
      >
        <span className={PRACTITIONER_DETAILS_SUMMARY_BODY_CLASS}>
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
        </span>
        <DisclosureChevron />
      </summary>

      <div className="mt-6 w-full border-t border-app-border pt-6">
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
            Expand the observation list to load standalone entries.
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
 * Per-patient practitioner view: read-only patient-logged timelines plus practitioner observation
 * notes on the patient record and on episodes (PRD §8; no writes to patient-owned PHI rows).
 *
 * Overlapping async loads (navigating between patients, rapid retries) are ignored once superseded
 * so an older response cannot replace state while the route targets a different `patientUserId`
 * (including error payloads and announcements: each `load` compares the route ref to its captured id).
 * While `loadState` may still hold the previous patient until `load` runs, **ready/error UI is gated**
 * on `patientUserId` so the current route never renders another patient’s PHI or errors.
 * `observationNotes` is cleared when each load starts so notes from the prior patient cannot appear
 * under the next patient’s header while the read model and notes requests are in flight.
 * `observationNotesLoading` keeps the notes panel from showing the empty-state message until
 * `listPractitionerObservationNotesForPatient` finishes.
 *
 * @param props - Patient user id from the route (trimmed once for loads, staleness checks, and UI).
 * @returns Patient detail UI with loading, error, and empty states.
 */
export function PractitionerPatientDetailPage({
  patientUserId: patientUserIdFromRoute,
}: PractitionerPatientDetailPageProps) {
  const patientUserId = patientUserIdFromRoute.trim();
  const { announce } = useAnnounce();
  const { session } = useAuth();
  const practitionerUserId = session?.user?.id ?? '';
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
  const [observationNotes, setObservationNotes] = useState<
    PractitionerObservationNoteRow[]
  >([]);
  const [observationNotesLoading, setObservationNotesLoading] = useState(true);
  const [observationNotesLoadError, setObservationNotesLoadError] = useState<
    string | null
  >(null);

  const load = useCallback(async () => {
    const requestToken = ++loadRequestTokenRef.current;
    setLoadState({ kind: 'loading' });
    setObservationNotes([]);
    setObservationNotesLoading(true);
    setObservationNotesLoadError(null);
    const result = await loadPractitionerPatientObservationReadModel(
      supabase,
      patientUserId,
    );

    if (requestToken !== loadRequestTokenRef.current) {
      return;
    }

    if (patientUserIdRef.current !== patientUserId) {
      return;
    }

    if (!result.ok) {
      // Align with practitioner-patients-page list load: MFA/RLS `permission_denied` → recovery copy;
      // keep explicit no-grant copy from `PRACTITIONER_PATIENT_OBSERVATION_GRANT_DENIED_MESSAGE`.
      const message =
        result.error.code === 'permission_denied' &&
        result.error.message !==
          PRACTITIONER_PATIENT_OBSERVATION_GRANT_DENIED_MESSAGE
          ? 'Patient access requires two-factor sign-in for this session. Sign out, sign in again, and complete MFA when prompted.'
          : result.error.message;
      setLoadState({ kind: 'error', patientUserId, message });
      setObservationNotesLoading(false);
      announce(message, { politeness: 'assertive' });
      return;
    }

    if (result.data.patientUserId !== patientUserIdRef.current) {
      return;
    }

    setLoadState({ kind: 'ready', model: result.data });

    const notesResult = await listPractitionerObservationNotesForPatient(
      supabase,
      patientUserId,
    );
    if (
      requestToken === loadRequestTokenRef.current &&
      patientUserIdRef.current === patientUserId
    ) {
      setObservationNotesLoading(false);
      if (notesResult.ok) {
        setObservationNotes(notesResult.data);
        setObservationNotesLoadError(null);
      } else {
        setObservationNotes([]);
        setObservationNotesLoadError(notesResult.error.message);
        announce(notesResult.error.message, { politeness: 'assertive' });
      }
    }

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
    if (
      loadState.kind === 'ready' &&
      loadState.model.patientUserId === patientUserId
    ) {
      return formatPractitionerPatientDirectoryLabel(
        patientUserId,
        loadState.model.patientDisplayName,
      );
    }
    return formatPractitionerPatientDirectoryLabel(patientUserId, null);
  }, [loadState, patientUserId]);

  const routeReadyModel =
    loadState.kind === 'ready' &&
    loadState.model.patientUserId === patientUserId
      ? loadState.model
      : null;

  const errorMessage =
    loadState.kind === 'error' && loadState.patientUserId === patientUserId
      ? loadState.message
      : null;

  const isLoading =
    loadState.kind === 'loading' ||
    (loadState.kind === 'ready' &&
      loadState.model.patientUserId !== patientUserId) ||
    (loadState.kind === 'error' && loadState.patientUserId !== patientUserId);

  const model = routeReadyModel;

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
          Patient-logged timeline (read-only) plus practitioner observation
          notes you can add or edit on this record and on individual episodes.
        </p>
      </header>

      {model && practitionerUserId ? (
        <PractitionerObservationNotesPanel
          supabase={supabase}
          patientUserId={patientUserId}
          practitionerUserId={practitionerUserId}
          notes={observationNotes}
          onNotesChange={setObservationNotes}
          notesLoading={observationNotesLoading}
          notesLoadError={observationNotesLoadError}
          headingId={`${pageId}-patient-notes-heading`}
          heading="Patient record observation notes"
          description="Notes about this patient that are not tied to a specific episode. Patients can read notes you save."
          emptyListMessage="No patient-level observation notes yet."
          composeSubmitLabel="Save patient note"
        />
      ) : null}

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
              ({
                episode,
                timeline,
                moreSymptomsOmitted,
                moreHealthMarkersOmitted,
                moreFoodDiaryOmitted,
              }) => {
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
                      regionId={regionId}
                      supabase={supabase}
                      patientUserId={patientUserId}
                      practitionerUserId={practitionerUserId}
                      observationNotes={observationNotes}
                      onObservationNotesChange={setObservationNotes}
                      observationNotesLoading={observationNotesLoading}
                      observationNotesLoadError={observationNotesLoadError}
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
