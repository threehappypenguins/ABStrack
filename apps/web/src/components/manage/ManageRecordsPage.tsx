'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  deleteFoodDiaryEntry,
  deleteHealthMarkerById,
  getActiveEpisodeForUser,
  listCompletedEpisodesForUser,
  listFoodDiaryEntriesForUser,
  listStandaloneHealthMarkersForUser,
} from '@abstrack/supabase';
import {
  PRESET_HEALTH_MARKER_KIND_LABELS,
  type EpisodeRow,
  type FoodDiaryEntryRow,
  type HealthMarkerRow,
} from '@abstrack/types';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { ActiveEpisodeCard } from '@/components/episodes/ActiveEpisodeCard';
import { EpisodeLocaleInstant } from '@/components/episodes/EpisodeLocaleInstant';
import { RecentEpisodesList } from '@/components/episodes/RecentEpisodesList';
import { ConfirmDialog } from '@/components/symptom-presets/ConfirmDialog';
import { createBrowserClient } from '@/lib/supabase/browser-client';

const PAGE = 25;

export type ManageSegment = 'episodes' | 'health' | 'food';

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function healthMarkerTitle(row: HealthMarkerRow): string {
  if (row.marker_kind === 'custom') {
    const n = row.custom_name?.trim();
    return n && n.length > 0 ? n : PRESET_HEALTH_MARKER_KIND_LABELS.custom;
  }
  if (row.marker_kind === 'wellness_mood') {
    return 'Wellness mood';
  }
  return PRESET_HEALTH_MARKER_KIND_LABELS[
    row.marker_kind as keyof typeof PRESET_HEALTH_MARKER_KIND_LABELS
  ];
}

function healthMarkerValueLine(row: HealthMarkerRow): string {
  if (row.marker_kind === 'blood_pressure') {
    return `${row.systolic_numeric ?? '—'} / ${row.diastolic_numeric ?? '—'}`;
  }
  if (row.value_numeric != null) {
    const u = row.custom_unit?.trim();
    return u ? `${row.value_numeric} ${u}` : String(row.value_numeric);
  }
  return '—';
}

/**
 * Authenticated manage hub: episodes, standalone health markers, and standalone food diary rows.
 *
 * @returns Client page with segmented lists, filters, and delete flows.
 */
export function ManageRecordsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { announce } = useAnnounce();
  const segmentParam = searchParams.get('segment');
  const segment: ManageSegment =
    segmentParam === 'health' || segmentParam === 'food'
      ? segmentParam
      : 'episodes';

  const setSegment = useCallback(
    (next: ManageSegment) => {
      router.replace(`/manage?segment=${next}`, { scroll: false });
    },
    [router],
  );

  const [dateFilter, setDateFilter] = useState<string>('');

  const episodeBounds = useMemo(() => {
    if (!dateFilter) {
      return {
        endedAtOrAfter: undefined as string | undefined,
        endedAtOrBefore: undefined as string | undefined,
      };
    }
    const d = new Date(`${dateFilter}T12:00:00`);
    if (Number.isNaN(d.getTime())) {
      return {
        endedAtOrAfter: undefined as string | undefined,
        endedAtOrBefore: undefined as string | undefined,
      };
    }
    return {
      endedAtOrAfter: startOfLocalDay(d).toISOString(),
      endedAtOrBefore: endOfLocalDay(d).toISOString(),
    };
  }, [dateFilter]);

  const markerBounds = useMemo(() => {
    if (!dateFilter) {
      return {
        recordedAtOrAfter: undefined as string | undefined,
        recordedAtOrBefore: undefined as string | undefined,
      };
    }
    const d = new Date(`${dateFilter}T12:00:00`);
    if (Number.isNaN(d.getTime())) {
      return {
        recordedAtOrAfter: undefined as string | undefined,
        recordedAtOrBefore: undefined as string | undefined,
      };
    }
    return {
      recordedAtOrAfter: startOfLocalDay(d).toISOString(),
      recordedAtOrBefore: endOfLocalDay(d).toISOString(),
    };
  }, [dateFilter]);

  const foodBounds = useMemo(() => {
    if (!dateFilter) {
      return {
        loggedAtOrAfter: undefined as string | undefined,
        loggedAtOrBefore: undefined as string | undefined,
      };
    }
    const d = new Date(`${dateFilter}T12:00:00`);
    if (Number.isNaN(d.getTime())) {
      return {
        loggedAtOrAfter: undefined as string | undefined,
        loggedAtOrBefore: undefined as string | undefined,
      };
    }
    return {
      loggedAtOrAfter: startOfLocalDay(d).toISOString(),
      loggedAtOrBefore: endOfLocalDay(d).toISOString(),
    };
  }, [dateFilter]);

  /** Episodes tab */
  const [activeEpisode, setActiveEpisode] = useState<EpisodeRow | null>(null);
  const [activeEpisodeError, setActiveEpisodeError] = useState<string | null>(
    null,
  );
  const [recentEpisodes, setRecentEpisodes] = useState<EpisodeRow[]>([]);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [episodesLoading, setEpisodesLoading] = useState(true);
  const [hasMoreEpisodes, setHasMoreEpisodes] = useState(false);
  const [loadingMoreEpisodes, setLoadingMoreEpisodes] = useState(false);
  const episodesLoadGenRef = useRef(0);
  useEffect(() => {
    if (segment !== 'episodes') {
      episodesLoadGenRef.current += 1;
    }
  }, [segment]);

  const loadEpisodesInitial = useCallback(async () => {
    const generation = ++episodesLoadGenRef.current;
    const stale = () => generation !== episodesLoadGenRef.current;
    setEpisodesLoading(true);
    setActiveEpisodeError(null);
    setRecentError(null);
    try {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (stale()) {
        return;
      }
      if (!user) {
        setActiveEpisode(null);
        setRecentEpisodes([]);
        setHasMoreEpisodes(false);
        return;
      }
      const [activeRes, recentRes] = await Promise.all([
        getActiveEpisodeForUser(supabase, user.id),
        listCompletedEpisodesForUser(supabase, user.id, {
          limit: PAGE,
          offset: 0,
          endedAtOrAfter: episodeBounds.endedAtOrAfter,
          endedAtOrBefore: episodeBounds.endedAtOrBefore,
        }),
      ]);
      if (stale()) {
        return;
      }
      if (!activeRes.ok) {
        setActiveEpisodeError(activeRes.error.message);
        setActiveEpisode(null);
      } else {
        setActiveEpisode(activeRes.data);
      }
      if (!recentRes.ok) {
        setRecentError(recentRes.error.message);
        setRecentEpisodes([]);
        setHasMoreEpisodes(false);
      } else {
        setRecentEpisodes(recentRes.data);
        setHasMoreEpisodes(recentRes.data.length === PAGE);
      }
    } catch {
      setActiveEpisodeError('Unable to load episodes.');
      setRecentError('Unable to load episodes.');
      setActiveEpisode(null);
      setRecentEpisodes([]);
      setHasMoreEpisodes(false);
    } finally {
      if (!stale()) {
        setEpisodesLoading(false);
      }
    }
  }, [episodeBounds.endedAtOrAfter, episodeBounds.endedAtOrBefore]);

  useEffect(() => {
    if (segment === 'episodes') {
      void loadEpisodesInitial();
    }
  }, [segment, loadEpisodesInitial]);

  const loadMoreEpisodes = useCallback(async () => {
    if (loadingMoreEpisodes || !hasMoreEpisodes) {
      return;
    }
    const generation = episodesLoadGenRef.current;
    const stale = () => generation !== episodesLoadGenRef.current;
    setLoadingMoreEpisodes(true);
    try {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (stale()) {
        return;
      }
      if (!user) {
        setHasMoreEpisodes(false);
        return;
      }
      const recentRes = await listCompletedEpisodesForUser(supabase, user.id, {
        limit: PAGE,
        offset: recentEpisodes.length,
        endedAtOrAfter: episodeBounds.endedAtOrAfter,
        endedAtOrBefore: episodeBounds.endedAtOrBefore,
      });
      if (stale()) {
        return;
      }
      if (!recentRes.ok) {
        announce(recentRes.error.message, { politeness: 'assertive' });
        return;
      }
      setRecentEpisodes((prev) => [...prev, ...recentRes.data]);
      setHasMoreEpisodes(recentRes.data.length === PAGE);
    } catch {
      if (!stale()) {
        announce('Unable to load more episodes.', { politeness: 'assertive' });
      }
    } finally {
      setLoadingMoreEpisodes(false);
    }
  }, [
    announce,
    episodeBounds.endedAtOrAfter,
    episodeBounds.endedAtOrBefore,
    hasMoreEpisodes,
    loadingMoreEpisodes,
    recentEpisodes.length,
  ]);

  /** Health tab */
  const [markers, setMarkers] = useState<HealthMarkerRow[]>([]);
  const [markersError, setMarkersError] = useState<string | null>(null);
  const [markersLoading, setMarkersLoading] = useState(true);
  const [hasMoreMarkers, setHasMoreMarkers] = useState(false);
  const [loadingMoreMarkers, setLoadingMoreMarkers] = useState(false);
  const [pendingDeleteMarker, setPendingDeleteMarker] =
    useState<HealthMarkerRow | null>(null);
  const [deletingMarker, setDeletingMarker] = useState(false);
  const markersLoadGenRef = useRef(0);
  useEffect(() => {
    if (segment !== 'health') {
      markersLoadGenRef.current += 1;
    }
  }, [segment]);

  const loadMarkersInitial = useCallback(async () => {
    const generation = ++markersLoadGenRef.current;
    const stale = () => generation !== markersLoadGenRef.current;
    setMarkersLoading(true);
    setMarkersError(null);
    try {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (stale()) {
        return;
      }
      if (!user) {
        setMarkers([]);
        setHasMoreMarkers(false);
        return;
      }
      const res = await listStandaloneHealthMarkersForUser(supabase, user.id, {
        limit: PAGE,
        offset: 0,
        recordedAtOrAfter: markerBounds.recordedAtOrAfter,
        recordedAtOrBefore: markerBounds.recordedAtOrBefore,
      });
      if (stale()) {
        return;
      }
      if (!res.ok) {
        setMarkersError(res.error.message);
        setMarkers([]);
        setHasMoreMarkers(false);
        return;
      }
      setMarkers(res.data);
      setHasMoreMarkers(res.data.length === PAGE);
    } catch {
      setMarkersError('Unable to load health markers.');
      setMarkers([]);
      setHasMoreMarkers(false);
    } finally {
      if (!stale()) {
        setMarkersLoading(false);
      }
    }
  }, [markerBounds.recordedAtOrAfter, markerBounds.recordedAtOrBefore]);

  useEffect(() => {
    if (segment === 'health') {
      void loadMarkersInitial();
    }
  }, [segment, loadMarkersInitial]);

  const loadMoreMarkers = useCallback(async () => {
    if (loadingMoreMarkers || !hasMoreMarkers) {
      return;
    }
    const generation = markersLoadGenRef.current;
    const stale = () => generation !== markersLoadGenRef.current;
    setLoadingMoreMarkers(true);
    try {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (stale()) {
        return;
      }
      if (!user) {
        setHasMoreMarkers(false);
        return;
      }
      const res = await listStandaloneHealthMarkersForUser(supabase, user.id, {
        limit: PAGE,
        offset: markers.length,
        recordedAtOrAfter: markerBounds.recordedAtOrAfter,
        recordedAtOrBefore: markerBounds.recordedAtOrBefore,
      });
      if (stale()) {
        return;
      }
      if (!res.ok) {
        announce(res.error.message, { politeness: 'assertive' });
        return;
      }
      setMarkers((prev) => [...prev, ...res.data]);
      setHasMoreMarkers(res.data.length === PAGE);
    } catch {
      if (!stale()) {
        announce('Unable to load more health markers.', {
          politeness: 'assertive',
        });
      }
    } finally {
      setLoadingMoreMarkers(false);
    }
  }, [
    announce,
    hasMoreMarkers,
    loadingMoreMarkers,
    markerBounds.recordedAtOrAfter,
    markerBounds.recordedAtOrBefore,
    markers.length,
  ]);

  const confirmDeleteMarker = useCallback(async (): Promise<void | false> => {
    if (!pendingDeleteMarker || deletingMarker) {
      return false;
    }
    setDeletingMarker(true);
    try {
      const supabase = createBrowserClient();
      const res = await deleteHealthMarkerById(
        supabase,
        pendingDeleteMarker.id,
      );
      if (!res.ok) {
        announce(res.error.message, { politeness: 'assertive' });
        return false;
      }
      announce(
        res.data ? 'Health marker deleted.' : 'Entry was already removed.',
        { politeness: 'polite' },
      );
      setPendingDeleteMarker(null);
      await loadMarkersInitial();
      return;
    } finally {
      setDeletingMarker(false);
    }
  }, [announce, deletingMarker, loadMarkersInitial, pendingDeleteMarker]);

  /** Food tab */
  const [foodRows, setFoodRows] = useState<FoodDiaryEntryRow[]>([]);
  const [foodError, setFoodError] = useState<string | null>(null);
  const [foodLoading, setFoodLoading] = useState(true);
  const [hasMoreFood, setHasMoreFood] = useState(false);
  const [loadingMoreFood, setLoadingMoreFood] = useState(false);
  const [pendingDeleteFood, setPendingDeleteFood] =
    useState<FoodDiaryEntryRow | null>(null);
  const [deletingFood, setDeletingFood] = useState(false);
  const foodLoadGenRef = useRef(0);
  useEffect(() => {
    if (segment !== 'food') {
      foodLoadGenRef.current += 1;
    }
  }, [segment]);

  useEffect(() => {
    return () => {
      episodesLoadGenRef.current += 1;
      markersLoadGenRef.current += 1;
      foodLoadGenRef.current += 1;
    };
  }, []);

  const loadFoodInitial = useCallback(async () => {
    const generation = ++foodLoadGenRef.current;
    const stale = () => generation !== foodLoadGenRef.current;
    setFoodLoading(true);
    setFoodError(null);
    try {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (stale()) {
        return;
      }
      if (!user) {
        setFoodRows([]);
        setHasMoreFood(false);
        return;
      }
      const res = await listFoodDiaryEntriesForUser(supabase, user.id, {
        limit: PAGE,
        offset: 0,
        standaloneOnly: true,
        loggedAtOrAfter: foodBounds.loggedAtOrAfter,
        loggedAtOrBefore: foodBounds.loggedAtOrBefore,
      });
      if (stale()) {
        return;
      }
      if (!res.ok) {
        setFoodError(res.error.message);
        setFoodRows([]);
        setHasMoreFood(false);
        return;
      }
      setFoodRows(res.data);
      setHasMoreFood(res.data.length === PAGE);
    } catch {
      setFoodError('Unable to load food diary entries.');
      setFoodRows([]);
      setHasMoreFood(false);
    } finally {
      if (!stale()) {
        setFoodLoading(false);
      }
    }
  }, [foodBounds.loggedAtOrAfter, foodBounds.loggedAtOrBefore]);

  useEffect(() => {
    if (segment === 'food') {
      void loadFoodInitial();
    }
  }, [segment, loadFoodInitial]);

  const loadMoreFood = useCallback(async () => {
    if (loadingMoreFood || !hasMoreFood) {
      return;
    }
    const generation = foodLoadGenRef.current;
    const stale = () => generation !== foodLoadGenRef.current;
    setLoadingMoreFood(true);
    try {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (stale()) {
        return;
      }
      if (!user) {
        setHasMoreFood(false);
        return;
      }
      const res = await listFoodDiaryEntriesForUser(supabase, user.id, {
        limit: PAGE,
        offset: foodRows.length,
        standaloneOnly: true,
        loggedAtOrAfter: foodBounds.loggedAtOrAfter,
        loggedAtOrBefore: foodBounds.loggedAtOrBefore,
      });
      if (stale()) {
        return;
      }
      if (!res.ok) {
        announce(res.error.message, { politeness: 'assertive' });
        return;
      }
      setFoodRows((prev) => [...prev, ...res.data]);
      setHasMoreFood(res.data.length === PAGE);
    } catch {
      if (!stale()) {
        announce('Unable to load more food diary entries.', {
          politeness: 'assertive',
        });
      }
    } finally {
      setLoadingMoreFood(false);
    }
  }, [
    announce,
    foodBounds.loggedAtOrAfter,
    foodBounds.loggedAtOrBefore,
    foodRows.length,
    hasMoreFood,
    loadingMoreFood,
  ]);

  const confirmDeleteFood = useCallback(async (): Promise<void | false> => {
    if (!pendingDeleteFood || deletingFood) {
      return false;
    }
    setDeletingFood(true);
    try {
      const supabase = createBrowserClient();
      const res = await deleteFoodDiaryEntry(supabase, pendingDeleteFood.id);
      if (!res.ok) {
        announce(res.error.message, { politeness: 'assertive' });
        return false;
      }
      announce(
        res.data ? 'Food diary entry deleted.' : 'Entry was already removed.',
        { politeness: 'polite' },
      );
      setPendingDeleteFood(null);
      await loadFoodInitial();
      return;
    } finally {
      setDeletingFood(false);
    }
  }, [announce, deletingFood, loadFoodInitial, pendingDeleteFood]);

  const tabClass = (s: ManageSegment) =>
    segment === s
      ? 'inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full bg-app-primary-soft px-4 py-2 text-sm font-semibold text-app-primary shadow-sm ring-1 ring-app-primary/25 dark:bg-app-primary-soft/28'
      : 'inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full px-4 py-2 text-sm font-medium text-app-muted transition hover:bg-[var(--app-nav-hover-bg)] hover:text-app-ink';

  return (
    <div className="w-full space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Manage
        </h1>
        <p className="mt-1 text-sm text-app-muted">
          Review and delete episode history, standalone vitals, and standalone
          food diary entries. Newest first. Use the optional date filter to
          narrow each list to one local day.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Record categories"
        className="flex flex-wrap gap-2 rounded-2xl border border-app-border/90 bg-app-surface/80 p-2 shadow-sm dark:border-app-border-dark/90 dark:bg-app-surface-dark/60"
      >
        <button
          type="button"
          role="tab"
          aria-selected={segment === 'episodes'}
          className={tabClass('episodes')}
          onClick={() => setSegment('episodes')}
        >
          Episodes
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={segment === 'health'}
          className={tabClass('health')}
          onClick={() => setSegment('health')}
        >
          Health
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={segment === 'food'}
          className={tabClass('food')}
          onClick={() => setSegment('food')}
        >
          Food
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label
          className="text-sm font-medium text-app-ink"
          htmlFor="manage-date-filter"
        >
          Date filter
        </label>
        <input
          id="manage-date-filter"
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="min-h-[44px] rounded-lg border border-app-border bg-app-surface px-3 text-sm text-app-ink shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring dark:border-app-border-dark dark:bg-app-surface-dark"
        />
        {dateFilter ? (
          <button
            type="button"
            className="min-h-[44px] rounded-full px-4 text-sm font-semibold text-app-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
            onClick={() => {
              setDateFilter('');
              announce('Date filter cleared.', { politeness: 'polite' });
            }}
          >
            Clear date
          </button>
        ) : null}
      </div>

      {segment === 'episodes' ? (
        <div className="space-y-10">
          <section aria-labelledby="manage-active-heading">
            <h2
              id="manage-active-heading"
              className="text-lg font-semibold text-app-ink"
            >
              Active episode
            </h2>
            {episodesLoading ? (
              <p className="mt-3 text-sm text-app-muted">Loading…</p>
            ) : null}
            {activeEpisodeError ? (
              <p
                className="mt-3 text-sm text-red-700 dark:text-red-300"
                role="alert"
              >
                {activeEpisodeError}
              </p>
            ) : null}
            {!episodesLoading &&
            !activeEpisodeError &&
            activeEpisode === null ? (
              <p className="mt-3 rounded-xl border border-dashed border-app-border/90 bg-app-surface/60 p-4 text-sm text-app-muted">
                No episode in progress.{' '}
                <Link
                  href="/episode/start"
                  className="font-semibold text-app-primary underline underline-offset-2"
                >
                  Start an episode
                </Link>
                .
              </p>
            ) : null}
            {!episodesLoading &&
            !activeEpisodeError &&
            activeEpisode !== null ? (
              <ActiveEpisodeCard
                episode={activeEpisode}
                onAfterCancel={() => void loadEpisodesInitial()}
              />
            ) : null}
          </section>

          <section aria-labelledby="manage-recent-heading">
            <h2
              id="manage-recent-heading"
              className="text-lg font-semibold text-app-ink"
            >
              Recent episodes
            </h2>
            {recentError ? (
              <p
                className="mt-3 text-sm text-red-700 dark:text-red-300"
                role="alert"
              >
                {recentError}
              </p>
            ) : null}
            {!episodesLoading && !recentError && recentEpisodes.length === 0 ? (
              <p className="mt-3 text-sm text-app-muted">
                No ended episodes in your history for this filter.
              </p>
            ) : null}
            {!episodesLoading && !recentError && recentEpisodes.length > 0 ? (
              <RecentEpisodesList
                episodes={recentEpisodes}
                showEpisodeRecordHint
                onAfterDelete={() => void loadEpisodesInitial()}
              />
            ) : null}
            {hasMoreEpisodes && !recentError ? (
              <button
                type="button"
                className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-full border border-app-border bg-app-surface px-5 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-[var(--app-nav-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring disabled:opacity-60 dark:border-app-border-dark dark:bg-app-surface-dark"
                disabled={loadingMoreEpisodes}
                onClick={() => void loadMoreEpisodes()}
              >
                {loadingMoreEpisodes ? 'Loading…' : 'Load more episodes'}
              </button>
            ) : null}
          </section>
        </div>
      ) : null}

      {segment === 'health' ? (
        <section aria-labelledby="manage-health-heading">
          <h2
            id="manage-health-heading"
            className="text-lg font-semibold text-app-ink"
          >
            Standalone health markers
          </h2>
          <p className="mt-1 text-sm text-app-muted">
            Vitals logged without an episode. Episode-bound markers are removed
            when you delete the episode from the Episodes tab.
          </p>
          {markersLoading ? (
            <p className="mt-3 text-sm text-app-muted">Loading…</p>
          ) : null}
          {markersError ? (
            <p
              className="mt-3 text-sm text-red-700 dark:text-red-300"
              role="alert"
            >
              {markersError}
            </p>
          ) : null}
          {!markersLoading && !markersError && markers.length === 0 ? (
            <p className="mt-3 text-sm text-app-muted">
              No standalone markers for this filter.
            </p>
          ) : null}
          {!markersLoading && markers.length > 0 ? (
            <ul className="mt-4 space-y-3" role="list">
              {markers.map((row) => (
                <li
                  key={row.id}
                  className="rounded-xl border border-app-border/90 bg-app-surface p-4 shadow-soft dark:border-app-border-dark/90 dark:bg-app-surface-dark"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">
                    Standalone
                  </p>
                  <p className="mt-1 text-base font-semibold text-app-ink">
                    {healthMarkerTitle(row)}
                  </p>
                  <p className="mt-1 text-sm text-app-muted">
                    {healthMarkerValueLine(row)}
                  </p>
                  <p className="text-sm text-app-muted">
                    Recorded <EpisodeLocaleInstant iso={row.recorded_at} />
                  </p>
                  <details className="mt-3 rounded-lg border border-app-border/80 bg-app-bg/40 p-3 text-sm dark:border-app-border-dark/80">
                    <summary className="cursor-pointer text-sm font-semibold text-app-primary outline-none focus-visible:ring-2 focus-visible:ring-app-ring">
                      View details
                    </summary>
                    <p className="mt-2 text-xs text-app-muted">
                      {row.notes?.trim()
                        ? `Notes: ${row.notes.trim()}`
                        : 'No notes.'}
                    </p>
                  </details>
                  <button
                    type="button"
                    className="mt-3 text-sm font-medium text-red-700 hover:text-red-800 dark:text-red-300"
                    onClick={() => setPendingDeleteMarker(row)}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {hasMoreMarkers && !markersError ? (
            <button
              type="button"
              className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-full border border-app-border bg-app-surface px-5 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-[var(--app-nav-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring disabled:opacity-60 dark:border-app-border-dark dark:bg-app-surface-dark"
              disabled={loadingMoreMarkers}
              onClick={() => void loadMoreMarkers()}
            >
              {loadingMoreMarkers ? 'Loading…' : 'Load more'}
            </button>
          ) : null}
          <ConfirmDialog
            open={pendingDeleteMarker !== null}
            title="Delete this health marker?"
            description="This permanently removes this standalone measurement. This cannot be undone."
            confirmLabel="Delete"
            confirmBusyLabel="Deleting…"
            cancelLabel="Keep"
            onConfirm={confirmDeleteMarker}
            onClose={() => setPendingDeleteMarker(null)}
          />
        </section>
      ) : null}

      {segment === 'food' ? (
        <section aria-labelledby="manage-food-heading">
          <h2
            id="manage-food-heading"
            className="text-lg font-semibold text-app-ink"
          >
            Standalone food diary
          </h2>
          <p className="mt-1 text-sm text-app-muted">
            Entries logged outside an episode. If an episode is deleted, linked
            food entries are kept and become standalone here.
          </p>
          {foodLoading ? (
            <p className="mt-3 text-sm text-app-muted">Loading…</p>
          ) : null}
          {foodError ? (
            <p
              className="mt-3 text-sm text-red-700 dark:text-red-300"
              role="alert"
            >
              {foodError}
            </p>
          ) : null}
          {!foodLoading && !foodError && foodRows.length === 0 ? (
            <p className="mt-3 text-sm text-app-muted">
              No standalone entries for this filter.
            </p>
          ) : null}
          {!foodLoading && foodRows.length > 0 ? (
            <ul className="mt-4 space-y-3" role="list">
              {foodRows.map((row) => (
                <li
                  key={row.id}
                  className="rounded-xl border border-app-border/90 bg-app-surface p-4 shadow-soft dark:border-app-border-dark/90 dark:bg-app-surface-dark"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">
                    Standalone · {row.meal_tag}
                  </p>
                  <p className="mt-1 text-base text-app-ink">{row.food_note}</p>
                  <p className="mt-1 text-sm text-app-muted">
                    Logged <EpisodeLocaleInstant iso={row.logged_at} />
                  </p>
                  <details className="mt-3 rounded-lg border border-app-border/80 bg-app-bg/40 p-3 text-sm dark:border-app-border-dark/80">
                    <summary className="cursor-pointer text-sm font-semibold text-app-primary outline-none focus-visible:ring-2 focus-visible:ring-app-ring">
                      View details
                    </summary>
                    <p className="mt-2 text-xs text-app-muted">
                      Meal: {row.meal_tag}
                    </p>
                  </details>
                  <button
                    type="button"
                    className="mt-3 text-sm font-medium text-red-700 hover:text-red-800 dark:text-red-300"
                    onClick={() => setPendingDeleteFood(row)}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {hasMoreFood && !foodError ? (
            <button
              type="button"
              className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-full border border-app-border bg-app-surface px-5 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-[var(--app-nav-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring disabled:opacity-60 dark:border-app-border-dark dark:bg-app-surface-dark"
              disabled={loadingMoreFood}
              onClick={() => void loadMoreFood()}
            >
              {loadingMoreFood ? 'Loading…' : 'Load more'}
            </button>
          ) : null}
          <ConfirmDialog
            open={pendingDeleteFood !== null}
            title="Delete this food diary entry?"
            description="This permanently removes this entry. This cannot be undone."
            confirmLabel="Delete"
            confirmBusyLabel="Deleting…"
            cancelLabel="Keep"
            onConfirm={confirmDeleteFood}
            onClose={() => setPendingDeleteFood(null)}
          />
        </section>
      ) : null}
    </div>
  );
}
