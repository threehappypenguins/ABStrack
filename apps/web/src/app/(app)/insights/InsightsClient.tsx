'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { chartManifestSeriesDisplayLabel } from '@abstrack/types';
import {
  getChartSeries,
  getUserChartManifest,
  listUnseenChartSnapshotsForPatient,
  loadEpisodeInsightsOverview,
  markChartSnapshotSeen,
  type ChartSnapshotRow,
  type EpisodeStartHourDistributionRow,
  type EpisodeSummaryRow,
  type EpisodeWeekCountRow,
  type SymptomFrequencyRow,
  type UserChartManifestSeries,
} from '@abstrack/supabase';
import {
  InsightComposedChart,
  InsightDateRangePicker,
  filterChartableManifestRows,
  InsightSeriesPicker,
  InsightsSummarySection,
  pivotChartSeriesBucketRows,
  reconcileSelectedSeriesWithManifest,
  type ChartManifestRow,
  type InsightChartBucket,
  type InsightDateRange,
  type SelectedSeries,
} from '@abstrack/ui';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import {
  chartSnapshotBoundsToInsightDateRange,
  chartSnapshotDefinitionToSelectedSeries,
  formatInsightChartPageSummary,
  getDefaultInsightDateRange,
  insightDateRangeToRpcBounds,
  selectedSeriesToChartSeriesSelection,
} from '@/lib/insights/insight-chart-params';
import { useWebPhiSubjectUserContext } from '@/lib/patient/use-web-phi-subject-user-context';
import { createBrowserClient } from '@/lib/supabase/browser-client';

const BUCKET_OPTIONS: ReadonlyArray<{
  value: InsightChartBucket;
  label: string;
}> = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

const EMPTY_MANIFEST_MESSAGE =
  'No data to chart yet. Log some episodes or health markers to get started.';

function manifestToChartRows(
  rows: UserChartManifestSeries[],
): ChartManifestRow[] {
  return rows.map((row) => ({
    ...row,
    label: chartManifestSeriesDisplayLabel(
      row.series_type,
      row.series_id,
      row.label,
    ),
  }));
}

/**
 * Interactive insights chart builder: manifest, series and date filters, bucket size, and chart.
 *
 * @returns Client insights page content.
 */
export function InsightsClient() {
  const { announce } = useAnnounce();
  const dateRangeHeadingId = useId();
  const filtersHeadingId = useId();
  const chartOptionsHeadingId = useId();
  const bucketGroupId = useId();
  const {
    authUserId,
    phiSubjectUserId,
    loading: phiScopeLoading,
    errorMessage: phiScopeError,
  } = useWebPhiSubjectUserContext();

  /** Viewer browser zone for RPC bucketing and labels until patient IANA timezone is stored on profile. */
  const chartTimeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );
  const viewingAnotherPhiSubject =
    phiSubjectUserId != null &&
    authUserId != null &&
    phiSubjectUserId !== authUserId;
  const viewingOwnInsights =
    phiSubjectUserId != null &&
    authUserId != null &&
    phiSubjectUserId === authUserId;
  const showPatientTimeZoneNote = viewingAnotherPhiSubject;

  const [manifestLoading, setManifestLoading] = useState(true);
  const [manifest, setManifest] = useState<ChartManifestRow[]>([]);
  const [manifestError, setManifestError] = useState<string | null>(null);

  const [series, setSeries] = useState<SelectedSeries[]>([]);
  const [dateRange, setDateRange] = useState<InsightDateRange>(
    getDefaultInsightDateRange,
  );
  const [bucket, setBucket] = useState<InsightChartBucket>('day');

  const [chartLoading, setChartLoading] = useState(false);
  const [chartRows, setChartRows] = useState<
    ReturnType<typeof pivotChartSeriesBucketRows>
  >([]);
  const [chartError, setChartError] = useState<string | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewSummary, setOverviewSummary] =
    useState<EpisodeSummaryRow | null>(null);
  const [overviewWeekCounts, setOverviewWeekCounts] = useState<
    EpisodeWeekCountRow[]
  >([]);
  const [overviewSymptomFrequencies, setOverviewSymptomFrequencies] = useState<
    SymptomFrequencyRow[]
  >([]);
  const [overviewStartHourDistribution, setOverviewStartHourDistribution] =
    useState<EpisodeStartHourDistributionRow[]>([]);

  const [unseenSnapshots, setUnseenSnapshots] = useState<ChartSnapshotRow[]>(
    [],
  );
  const [sharedSnapshotNote, setSharedSnapshotNote] = useState<string | null>(
    null,
  );
  const [sharedSnapshotChartTimeZone, setSharedSnapshotChartTimeZone] =
    useState<string | null>(null);

  const manifestLoadGenRef = useRef(0);
  const chartLoadGenRef = useRef(0);
  const overviewLoadGenRef = useRef(0);
  const unseenSnapshotsLoadGenRef = useRef(0);
  const pendingSeenSnapshotIdRef = useRef<string | null>(null);
  /** Snapshot RPC bounds + timezone; set synchronously before series state updates. */
  const chartRpcBoundsOverrideRef = useRef<{
    p_from: string;
    p_to: string;
    p_timezone: string;
  } | null>(null);
  const phiSubjectUserIdRef = useRef(phiSubjectUserId);
  phiSubjectUserIdRef.current = phiSubjectUserId;
  /** PHI subject that owns the current picker selection (null after scope reset). */
  const selectionOwnerUserIdRef = useRef<string | null>(null);

  /** Drops in-flight manifest/chart loads when PHI scope changes or unmounts. */
  const invalidateInsightsLoads = useCallback(() => {
    manifestLoadGenRef.current += 1;
    chartLoadGenRef.current += 1;
    overviewLoadGenRef.current += 1;
  }, []);

  const resetInsightsPatientState = useCallback(() => {
    selectionOwnerUserIdRef.current = null;
    pendingSeenSnapshotIdRef.current = null;
    chartRpcBoundsOverrideRef.current = null;
    setSeries([]);
    setChartLoading(false);
    setChartRows([]);
    setChartError(null);
    setSharedSnapshotNote(null);
    setSharedSnapshotChartTimeZone(null);
    setOverviewLoading(false);
    setOverviewError(null);
    setOverviewSummary(null);
    setOverviewWeekCounts([]);
    setOverviewSymptomFrequencies([]);
    setOverviewStartHourDistribution([]);
  }, []);

  const handleSeriesChange = useCallback(
    (next: SelectedSeries[]) => {
      selectionOwnerUserIdRef.current = phiSubjectUserId;
      pendingSeenSnapshotIdRef.current = null;
      chartRpcBoundsOverrideRef.current = null;
      setSharedSnapshotNote(null);
      setSharedSnapshotChartTimeZone(null);
      setSeries(next);
    },
    [phiSubjectUserId],
  );

  const handleDateRangeChange = useCallback((next: InsightDateRange) => {
    pendingSeenSnapshotIdRef.current = null;
    chartRpcBoundsOverrideRef.current = null;
    setSharedSnapshotNote(null);
    setSharedSnapshotChartTimeZone(null);
    setDateRange(next);
  }, []);

  const handleBucketChange = useCallback((next: InsightChartBucket) => {
    pendingSeenSnapshotIdRef.current = null;
    chartRpcBoundsOverrideRef.current = null;
    setSharedSnapshotNote(null);
    setSharedSnapshotChartTimeZone(null);
    setBucket(next);
  }, []);

  const activeChartTimeZone = sharedSnapshotChartTimeZone ?? chartTimeZone;
  const showSharedChartTimeZoneNote = sharedSnapshotChartTimeZone != null;

  const chartableManifest = useMemo(
    () => filterChartableManifestRows(manifest),
    [manifest],
  );

  const phiScopeReady =
    !phiScopeLoading && !phiScopeError && phiSubjectUserId != null;

  const manifestIsEmpty =
    phiScopeReady &&
    !manifestLoading &&
    !manifestError &&
    chartableManifest.length === 0;

  const chartSummary = useMemo(
    () =>
      formatInsightChartPageSummary(
        series.map((item) => item.label),
        dateRange,
        bucket,
      ),
    [series, dateRange, bucket],
  );

  const loadUnseenSnapshots = useCallback(async () => {
    if (!viewingOwnInsights || phiSubjectUserId == null) {
      setUnseenSnapshots([]);
      return;
    }

    const generation = ++unseenSnapshotsLoadGenRef.current;
    const supabase = createBrowserClient();
    const result = await listUnseenChartSnapshotsForPatient(
      supabase,
      phiSubjectUserId,
    );

    if (generation !== unseenSnapshotsLoadGenRef.current) {
      return;
    }

    if (!result.ok) {
      setUnseenSnapshots([]);
      return;
    }

    setUnseenSnapshots(result.data);
  }, [phiSubjectUserId, viewingOwnInsights]);

  const loadManifest = useCallback(async () => {
    if (phiSubjectUserId == null) {
      return;
    }
    const requestedUserId = phiSubjectUserId;
    const generation = ++manifestLoadGenRef.current;
    setManifestLoading(true);
    setManifestError(null);
    announce('Loading chart options.', { politeness: 'polite' });

    const supabase = createBrowserClient();
    const result = await getUserChartManifest(supabase, requestedUserId);

    if (
      generation !== manifestLoadGenRef.current ||
      requestedUserId !== phiSubjectUserIdRef.current
    ) {
      return;
    }

    setManifestLoading(false);

    if (!result.ok) {
      setManifest([]);
      setManifestError(result.error.message);
      announce(`Could not load chart options. ${result.error.message}`, {
        politeness: 'assertive',
      });
      return;
    }

    const chartManifest = manifestToChartRows(result.data);
    setManifest(chartManifest);
    setSeries((current) =>
      reconcileSelectedSeriesWithManifest(chartManifest, current),
    );
    announce('Chart options loaded.', { politeness: 'polite' });
  }, [announce, phiSubjectUserId]);

  const loadOverview = useCallback(async () => {
    if (phiSubjectUserId == null) {
      return;
    }

    const requestedUserId = phiSubjectUserId;
    const generation = ++overviewLoadGenRef.current;
    const rpcOverride = chartRpcBoundsOverrideRef.current;
    const { p_from, p_to } =
      rpcOverride ?? insightDateRangeToRpcBounds(dateRange);
    const overviewTimeZone = rpcOverride?.p_timezone ?? activeChartTimeZone;
    setOverviewLoading(true);
    setOverviewError(null);

    const supabase = createBrowserClient();
    const overviewResult = await loadEpisodeInsightsOverview(supabase, {
      p_user_id: requestedUserId,
      p_from,
      p_to,
      p_timezone: overviewTimeZone,
    });

    if (
      generation !== overviewLoadGenRef.current ||
      requestedUserId !== phiSubjectUserIdRef.current
    ) {
      return;
    }

    setOverviewLoading(false);

    if (!overviewResult.ok) {
      const message = overviewResult.error.message || 'Unknown error.';
      setOverviewSummary(null);
      setOverviewWeekCounts([]);
      setOverviewSymptomFrequencies([]);
      setOverviewStartHourDistribution([]);
      setOverviewError(message);
      announce(`Could not load overview insights. ${message}`, {
        politeness: 'assertive',
      });
      return;
    }

    setOverviewSummary(overviewResult.data.summary);
    setOverviewWeekCounts(overviewResult.data.weekCounts);
    setOverviewSymptomFrequencies(overviewResult.data.symptomFrequencies);
    setOverviewStartHourDistribution(overviewResult.data.startHourDistribution);
  }, [activeChartTimeZone, announce, dateRange, phiSubjectUserId]);

  useEffect(() => {
    if (viewingOwnInsights && phiScopeReady) {
      void loadUnseenSnapshots();
    } else {
      unseenSnapshotsLoadGenRef.current += 1;
      setUnseenSnapshots([]);
    }

    return () => {
      unseenSnapshotsLoadGenRef.current += 1;
    };
  }, [loadUnseenSnapshots, phiScopeReady, viewingOwnInsights]);

  useEffect(() => {
    invalidateInsightsLoads();
    resetInsightsPatientState();

    if (phiScopeLoading) {
      setManifestLoading(true);
      setManifest([]);
      setManifestError(null);
    } else if (phiSubjectUserId == null) {
      setManifestLoading(false);
      setManifest([]);
      setManifestError(null);
    } else {
      void loadManifest();
    }

    return () => {
      invalidateInsightsLoads();
    };
  }, [
    invalidateInsightsLoads,
    loadManifest,
    phiScopeLoading,
    phiSubjectUserId,
    resetInsightsPatientState,
  ]);

  useEffect(() => {
    overviewLoadGenRef.current += 1;

    if (phiScopeLoading) {
      setOverviewLoading(true);
      setOverviewError(null);
      setOverviewSummary(null);
      setOverviewWeekCounts([]);
      setOverviewSymptomFrequencies([]);
      setOverviewStartHourDistribution([]);
      return () => {
        overviewLoadGenRef.current += 1;
      };
    }

    if (phiSubjectUserId == null || phiScopeError) {
      setOverviewLoading(false);
      setOverviewError(null);
      setOverviewSummary(null);
      setOverviewWeekCounts([]);
      setOverviewSymptomFrequencies([]);
      setOverviewStartHourDistribution([]);
      return () => {
        overviewLoadGenRef.current += 1;
      };
    }

    void loadOverview();

    return () => {
      overviewLoadGenRef.current += 1;
    };
  }, [loadOverview, phiScopeError, phiScopeLoading, phiSubjectUserId]);

  const loadChartSeries = useCallback(async () => {
    if (phiSubjectUserId == null || series.length === 0) {
      return;
    }

    const requestedUserId = phiSubjectUserId;
    const requestedSeries = selectedSeriesToChartSeriesSelection(series);
    const generation = ++chartLoadGenRef.current;
    setChartLoading(true);
    setChartError(null);
    announce('Loading chart data.', { politeness: 'polite' });

    const rpcOverride = chartRpcBoundsOverrideRef.current;
    const { p_from, p_to } =
      rpcOverride ?? insightDateRangeToRpcBounds(dateRange);
    const supabase = createBrowserClient();
    const result = await getChartSeries(supabase, {
      p_user_id: requestedUserId,
      p_series: requestedSeries,
      p_from,
      p_to,
      p_bucket: bucket,
      p_timezone: rpcOverride?.p_timezone ?? chartTimeZone,
    });

    if (
      generation !== chartLoadGenRef.current ||
      requestedUserId !== phiSubjectUserIdRef.current
    ) {
      return;
    }

    setChartLoading(false);

    if (!result.ok) {
      setChartRows([]);
      setChartError(result.error.message);
      announce(`Could not load chart data. ${result.error.message}`, {
        politeness: 'assertive',
      });
      return;
    }

    setChartRows(pivotChartSeriesBucketRows(result.data));
    announce('Chart data loaded.', { politeness: 'polite' });

    const snapshotId = pendingSeenSnapshotIdRef.current;
    if (snapshotId != null) {
      pendingSeenSnapshotIdRef.current = null;
      const markResult = await markChartSnapshotSeen(supabase, snapshotId);
      if (markResult.ok) {
        setUnseenSnapshots((current) =>
          current.filter((row) => row.id !== snapshotId),
        );
        if (markResult.data) {
          announce('Shared chart marked as viewed.', { politeness: 'polite' });
        }
      }
    }
  }, [announce, bucket, chartTimeZone, dateRange, phiSubjectUserId, series]);

  const handleViewSharedChart = useCallback(() => {
    const snapshot = unseenSnapshots[0];
    if (snapshot == null || phiSubjectUserId == null) {
      return;
    }

    selectionOwnerUserIdRef.current = phiSubjectUserId;
    pendingSeenSnapshotIdRef.current = snapshot.id;
    const snapshotTimeZone = snapshot.chart_timezone?.trim() ?? null;
    const snapshotChartTimeZone =
      snapshotTimeZone != null && snapshotTimeZone.length > 0
        ? snapshotTimeZone
        : chartTimeZone;
    chartRpcBoundsOverrideRef.current = {
      p_from: snapshot.date_from,
      p_to: snapshot.date_to,
      p_timezone: snapshotChartTimeZone,
    };
    setSharedSnapshotNote(snapshot.practitioner_note);
    setSharedSnapshotChartTimeZone(
      snapshotTimeZone != null && snapshotTimeZone.length > 0
        ? snapshotTimeZone
        : null,
    );
    setSeries(
      chartSnapshotDefinitionToSelectedSeries(snapshot.series_definition),
    );
    setDateRange(
      chartSnapshotBoundsToInsightDateRange(
        snapshot.date_from,
        snapshot.date_to,
        snapshotTimeZone,
      ),
    );
    setBucket(snapshot.bucket);
    announce('Loading your practitioner’s shared chart.', {
      politeness: 'polite',
    });
  }, [announce, chartTimeZone, phiSubjectUserId, unseenSnapshots]);

  useEffect(() => {
    const selectionOwnedByCurrentSubject =
      selectionOwnerUserIdRef.current === phiSubjectUserId;
    const selectionMatchesManifest =
      series.length > 0 &&
      series.every((item) =>
        manifest.some((row) => row.series_id === item.seriesId),
      );
    const viewingSharedSnapshot = chartRpcBoundsOverrideRef.current != null;

    if (
      manifestLoading ||
      phiScopeLoading ||
      phiSubjectUserId == null ||
      series.length === 0 ||
      !selectionOwnedByCurrentSubject ||
      (!selectionMatchesManifest && !viewingSharedSnapshot)
    ) {
      chartLoadGenRef.current += 1;
      setChartLoading(false);
      setChartRows([]);
      setChartError(null);
    } else {
      void loadChartSeries();
    }

    return () => {
      chartLoadGenRef.current += 1;
    };
  }, [
    loadChartSeries,
    manifest,
    manifestLoading,
    phiScopeLoading,
    phiSubjectUserId,
    series,
  ]);

  const showChartSection = series.length > 0;

  return (
    <div className="w-full space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Insights
        </h1>
        <p className="mt-1 text-sm text-app-muted">
          Explore trends in your health markers and symptoms over time.
        </p>
      </header>

      {phiScopeError ? (
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {phiScopeError}
        </p>
      ) : null}

      {viewingOwnInsights && unseenSnapshots.length > 0 ? (
        <div
          className="rounded-2xl border border-app-primary/30 bg-app-primary/5 p-4 shadow-soft ring-1 ring-app-primary/20"
          role="region"
          aria-label="Shared chart notification"
        >
          <button
            type="button"
            className="w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
            onClick={handleViewSharedChart}
          >
            <p className="text-base font-semibold text-app-ink">
              Your practitioner shared a chart with you.
            </p>
            <p className="mt-1 text-sm text-app-muted">
              {unseenSnapshots.length === 1
                ? 'Tap to view the chart your practitioner selected.'
                : `Tap to view the most recent of ${unseenSnapshots.length} shared charts.`}
            </p>
          </button>
        </div>
      ) : null}

      {phiScopeReady ? (
        <section
          aria-labelledby={dateRangeHeadingId}
          className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8"
        >
          <h2
            id={dateRangeHeadingId}
            className="text-lg font-semibold text-app-ink"
          >
            Time period
          </h2>
          <p className="mt-1 text-sm text-app-muted">
            The overview and custom chart below stay in sync with this selected
            range.
          </p>
          <div className="mt-6">
            <InsightDateRangePicker
              value={dateRange}
              onChange={handleDateRangeChange}
            />
          </div>
        </section>
      ) : null}

      {phiScopeReady ? (
        <InsightsSummarySection
          dateRange={dateRange}
          timeZone={activeChartTimeZone}
          summary={overviewSummary}
          weekCounts={overviewWeekCounts}
          symptomFrequencies={overviewSymptomFrequencies}
          startHourDistribution={overviewStartHourDistribution}
          loading={overviewLoading}
          error={overviewError}
        />
      ) : null}

      {phiScopeReady ? (
        <section aria-labelledby={filtersHeadingId} className="space-y-6">
          <div className="space-y-1">
            <h2
              id={filtersHeadingId}
              className="text-xl font-semibold tracking-tight text-app-ink"
            >
              Custom exploration
            </h2>
            <p className="text-sm text-app-muted">
              Use the chart builder to dig into a pattern from the overview or a
              chart your practitioner shared.
            </p>
          </div>

          {manifestLoading ? (
            <p className="text-sm text-app-muted" role="status">
              Loading chart options…
            </p>
          ) : null}

          {manifestError ? (
            <p className="text-sm text-red-700 dark:text-red-300" role="alert">
              {manifestError}
            </p>
          ) : null}

          {manifestIsEmpty ? (
            <p className="text-sm text-app-muted" role="status">
              {EMPTY_MANIFEST_MESSAGE}
            </p>
          ) : null}

          {!manifestLoading &&
          !manifestError &&
          chartableManifest.length > 0 ? (
            <>
              <div
                className="space-y-6 rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8"
                aria-labelledby={chartOptionsHeadingId}
              >
                <h3
                  id={chartOptionsHeadingId}
                  className="text-lg font-semibold text-app-ink"
                >
                  Choose data series
                </h3>
                <InsightSeriesPicker
                  manifest={manifest}
                  value={series}
                  onChange={handleSeriesChange}
                  timeZone={activeChartTimeZone}
                />
              </div>

              {showChartSection ? (
                <section
                  aria-labelledby="insights-chart-heading"
                  className="space-y-4 rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8"
                >
                  <h3
                    id="insights-chart-heading"
                    className="text-lg font-semibold text-app-ink"
                  >
                    Explore chart
                  </h3>

                  {sharedSnapshotNote ? (
                    <div
                      className="rounded-lg border border-app-border bg-app-bg/80 px-4 py-3 text-sm text-app-ink"
                      role="note"
                    >
                      <p className="font-medium text-app-ink">
                        Note from your practitioner
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-app-muted">
                        {sharedSnapshotNote}
                      </p>
                    </div>
                  ) : null}

                  <div
                    role="group"
                    aria-labelledby={bucketGroupId}
                    className="flex flex-wrap gap-2"
                  >
                    <span id={bucketGroupId} className="sr-only">
                      Group chart by
                    </span>
                    {BUCKET_OPTIONS.map(({ value, label }) => {
                      const selected = bucket === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={selected ? 'true' : 'false'}
                          className={
                            selected
                              ? 'inline-flex min-h-11 items-center justify-center rounded-lg border border-app-border bg-app-primary-solid px-4 text-base font-semibold text-app-on-primary-solid shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg'
                              : 'inline-flex min-h-11 items-center justify-center rounded-lg border border-app-border bg-app-surface px-4 text-base font-semibold text-app-ink shadow-sm transition hover:bg-[var(--app-nav-hover-bg)] outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg'
                          }
                          onClick={() => handleBucketChange(value)}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  {chartError ? (
                    <p
                      className="text-sm text-red-700 dark:text-red-300"
                      role="alert"
                    >
                      {chartError}
                    </p>
                  ) : (
                    <InsightComposedChart
                      series={series}
                      data={chartRows}
                      bucket={bucket}
                      loading={chartLoading}
                      summary={chartSummary}
                      patientTimeZone={activeChartTimeZone}
                      showPatientTimeZoneNote={
                        showPatientTimeZoneNote || showSharedChartTimeZoneNote
                      }
                      patientTimeZoneNoteVariant={
                        showSharedChartTimeZoneNote
                          ? 'practitionerShared'
                          : 'browser'
                      }
                    />
                  )}
                </section>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
