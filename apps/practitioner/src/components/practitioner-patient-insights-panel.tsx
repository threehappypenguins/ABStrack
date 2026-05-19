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
  CHART_SNAPSHOT_PRACTITIONER_NOTE_MAX_LENGTH,
  getChartSeries,
  getUserChartManifest,
  shareChartSnapshot,
  type AbstrackSupabaseClient,
  type UserChartManifestSeries,
} from '@abstrack/supabase';
import {
  InsightComposedChart,
  InsightDateRangePicker,
  filterChartableManifestRows,
  InsightSeriesPicker,
  pivotChartSeriesBucketRows,
  reconcileSelectedSeriesWithManifest,
  type ChartManifestRow,
  type InsightChartBucket,
  type InsightDateRange,
  type SelectedSeries,
} from '@abstrack/ui/insights-web';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import {
  formatInsightChartPageSummary,
  getDefaultInsightDateRange,
  insightDateRangeToRpcBounds,
  selectedSeriesToChartSeriesSelection,
  selectedSeriesToChartSnapshotDefinition,
} from '../lib/insights/insight-chart-params';
import { ConfirmDialog } from './ConfirmDialog';

const BUCKET_OPTIONS: ReadonlyArray<{
  value: InsightChartBucket;
  label: string;
}> = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

const EMPTY_MANIFEST_MESSAGE =
  'No data to chart yet for this patient. They need logged episodes or health markers first.';

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

export type PractitionerPatientInsightsPanelProps = {
  /** Patient `auth.users.id` — passed as `p_user_id` to chart RPCs. */
  patientUserId: string;
  supabase: AbstrackSupabaseClient;
};

/**
 * Practitioner-facing chart builder for a linked patient: manifest, filters, chart, and
 * share-with-patient snapshot flow (PRD §9).
 *
 * @param props - Patient subject id and browser Supabase client (practitioner JWT).
 * @returns Insights panel content for the patient detail Insights tab.
 */
export function PractitionerPatientInsightsPanel({
  patientUserId,
  supabase,
}: PractitionerPatientInsightsPanelProps) {
  const { announce } = useAnnounce();
  const filtersHeadingId = useId();
  const chartOptionsHeadingId = useId();
  const bucketGroupId = useId();
  const shareNoteFieldId = useId();
  const shareNoteHintId = useId();

  const chartTimeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );

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

  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareNote, setShareNote] = useState('');

  const manifestLoadGenRef = useRef(0);
  const chartLoadGenRef = useRef(0);
  const patientUserIdRef = useRef(patientUserId);
  patientUserIdRef.current = patientUserId;
  const selectionOwnerUserIdRef = useRef<string | null>(null);

  const invalidateInsightsLoads = useCallback(() => {
    manifestLoadGenRef.current += 1;
    chartLoadGenRef.current += 1;
  }, []);

  const resetInsightsPatientState = useCallback(() => {
    selectionOwnerUserIdRef.current = null;
    setSeries([]);
    setChartLoading(false);
    setChartRows([]);
    setChartError(null);
    setShareDialogOpen(false);
    setShareNote('');
  }, []);

  const handleSeriesChange = useCallback(
    (next: SelectedSeries[]) => {
      selectionOwnerUserIdRef.current = patientUserId;
      setSeries(next);
    },
    [patientUserId],
  );

  const chartableManifest = useMemo(
    () => filterChartableManifestRows(manifest),
    [manifest],
  );

  const manifestIsEmpty =
    !manifestLoading && !manifestError && chartableManifest.length === 0;

  const chartSummary = useMemo(
    () =>
      formatInsightChartPageSummary(
        series.map((item) => item.label),
        dateRange,
        bucket,
      ),
    [series, dateRange, bucket],
  );

  const loadManifest = useCallback(async () => {
    const requestedUserId = patientUserId;
    const generation = ++manifestLoadGenRef.current;
    setManifestLoading(true);
    setManifestError(null);
    announce('Loading chart options for this patient.', {
      politeness: 'polite',
    });

    const result = await getUserChartManifest(supabase, requestedUserId);

    if (
      generation !== manifestLoadGenRef.current ||
      requestedUserId !== patientUserIdRef.current
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
  }, [announce, patientUserId, supabase]);

  useEffect(() => {
    invalidateInsightsLoads();
    resetInsightsPatientState();
    void loadManifest();

    return () => {
      invalidateInsightsLoads();
    };
  }, [
    invalidateInsightsLoads,
    loadManifest,
    patientUserId,
    resetInsightsPatientState,
  ]);

  const loadChartSeries = useCallback(async () => {
    if (series.length === 0) {
      return;
    }

    const requestedUserId = patientUserId;
    const requestedSeries = selectedSeriesToChartSeriesSelection(series);
    const generation = ++chartLoadGenRef.current;
    setChartLoading(true);
    setChartError(null);
    announce('Loading chart data.', { politeness: 'polite' });

    const { p_from, p_to } = insightDateRangeToRpcBounds(dateRange);
    const result = await getChartSeries(supabase, {
      p_user_id: requestedUserId,
      p_series: requestedSeries,
      p_from,
      p_to,
      p_bucket: bucket,
      p_timezone: chartTimeZone,
    });

    if (
      generation !== chartLoadGenRef.current ||
      requestedUserId !== patientUserIdRef.current
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
  }, [
    announce,
    bucket,
    chartTimeZone,
    dateRange,
    patientUserId,
    series,
    supabase,
  ]);

  useEffect(() => {
    const selectionOwnedByCurrentSubject =
      selectionOwnerUserIdRef.current === patientUserId;
    const selectionMatchesManifest =
      series.length > 0 &&
      series.every((item) =>
        manifest.some((row) => row.series_id === item.seriesId),
      );

    if (
      manifestLoading ||
      series.length === 0 ||
      !selectionOwnedByCurrentSubject ||
      !selectionMatchesManifest
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
  }, [loadChartSeries, manifest, manifestLoading, patientUserId, series]);

  const showChartSection = series.length > 0;

  const handleShareConfirm = useCallback(async (): Promise<void | false> => {
    if (series.length === 0) {
      return false;
    }

    const { p_from, p_to } = insightDateRangeToRpcBounds(dateRange);
    const result = await shareChartSnapshot(supabase, {
      patientUserId,
      seriesDefinition: selectedSeriesToChartSnapshotDefinition(series),
      dateFrom: p_from,
      dateTo: p_to,
      bucket,
      chartTimezone: chartTimeZone,
      practitionerNote: shareNote,
    });

    if (!result.ok) {
      announce(`Could not share chart. ${result.error.message}`, {
        politeness: 'assertive',
      });
      return false;
    }

    announce('Chart shared with patient.', { politeness: 'polite' });
    setShareNote('');
    return;
  }, [
    announce,
    bucket,
    chartTimeZone,
    dateRange,
    patientUserId,
    series,
    shareNote,
    supabase,
  ]);

  return (
    <div className="space-y-8">
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

      {!manifestLoading && !manifestError && chartableManifest.length > 0 ? (
        <section aria-labelledby={filtersHeadingId} className="space-y-6">
          <h2 id={filtersHeadingId} className="sr-only">
            Chart filters
          </h2>

          <div
            className="space-y-6 rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8"
            aria-labelledby={chartOptionsHeadingId}
          >
            <h3
              id={chartOptionsHeadingId}
              className="text-lg font-semibold text-app-ink"
            >
              What to chart
            </h3>
            <InsightSeriesPicker
              manifest={manifest}
              value={series}
              onChange={handleSeriesChange}
            />
            <InsightDateRangePicker value={dateRange} onChange={setDateRange} />
          </div>

          {showChartSection ? (
            <section
              aria-labelledby="practitioner-insights-chart-heading"
              className="space-y-4 rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8"
            >
              <h3
                id="practitioner-insights-chart-heading"
                className="text-lg font-semibold text-app-ink"
              >
                Chart
              </h3>

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
                      aria-pressed={selected}
                      className={
                        selected
                          ? 'inline-flex min-h-11 items-center justify-center rounded-lg border border-app-border bg-app-primary px-4 text-base font-semibold text-white shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg'
                          : 'inline-flex min-h-11 items-center justify-center rounded-lg border border-app-border bg-app-surface px-4 text-base font-semibold text-app-ink shadow-sm transition hover:bg-[var(--app-nav-hover-bg)] outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg'
                      }
                      onClick={() => setBucket(value)}
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
                  patientTimeZone={chartTimeZone}
                  showPatientTimeZoneNote
                  patientTimeZoneNoteUsesPatientLocal={false}
                />
              )}

              <div className="pt-2">
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-app-border bg-app-surface px-4 text-base font-semibold text-app-ink shadow-sm transition hover:bg-[var(--app-nav-hover-bg)] outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={chartLoading || Boolean(chartError)}
                  onClick={() => setShareDialogOpen(true)}
                >
                  Share with patient
                </button>
              </div>
            </section>
          ) : null}
        </section>
      ) : null}

      <ConfirmDialog
        open={shareDialogOpen}
        title="Share chart with patient"
        description="The patient will see this chart configuration and your note in their Insights page."
        confirmLabel="Share chart"
        cancelLabel="Cancel"
        onClose={() => {
          setShareDialogOpen(false);
          setShareNote('');
        }}
        onConfirm={handleShareConfirm}
      >
        <label
          htmlFor={shareNoteFieldId}
          className="block text-sm font-medium text-app-ink"
        >
          Note for patient (optional)
        </label>
        <textarea
          id={shareNoteFieldId}
          value={shareNote}
          onChange={(event) => setShareNote(event.target.value)}
          rows={4}
          maxLength={CHART_SNAPSHOT_PRACTITIONER_NOTE_MAX_LENGTH}
          aria-describedby={shareNoteHintId}
          className="mt-2 w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm text-app-ink shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
          placeholder="Add context about what you want them to notice"
        />
        <p id={shareNoteHintId} className="mt-1.5 text-xs text-app-muted">
          {(
            CHART_SNAPSHOT_PRACTITIONER_NOTE_MAX_LENGTH - shareNote.length
          ).toLocaleString()}{' '}
          characters remaining (max{' '}
          {CHART_SNAPSHOT_PRACTITIONER_NOTE_MAX_LENGTH.toLocaleString()}).
        </p>
      </ConfirmDialog>
    </div>
  );
}
