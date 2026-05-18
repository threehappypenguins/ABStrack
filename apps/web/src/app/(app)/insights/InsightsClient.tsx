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
  type UserChartManifestSeries,
} from '@abstrack/supabase';
import {
  InsightComposedChart,
  InsightDateRangePicker,
  InsightSeriesPicker,
  pivotChartSeriesBucketRows,
  type ChartManifestRow,
  type InsightChartBucket,
  type InsightDateRange,
  type SelectedSeries,
} from '@abstrack/ui';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import {
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
  const filtersHeadingId = useId();
  const chartOptionsHeadingId = useId();
  const bucketGroupId = useId();
  const {
    authUserId,
    phiSubjectUserId,
    loading: phiScopeLoading,
    errorMessage: phiScopeError,
  } = useWebPhiSubjectUserContext();

  const patientTimeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );
  const showPatientTimeZoneNote =
    phiSubjectUserId != null &&
    authUserId != null &&
    phiSubjectUserId !== authUserId;

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

  const manifestLoadGenRef = useRef(0);
  const chartLoadGenRef = useRef(0);

  const manifestIsEmpty =
    !manifestLoading && !manifestError && manifest.length === 0;

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
    if (phiSubjectUserId == null) {
      return;
    }
    const generation = ++manifestLoadGenRef.current;
    setManifestLoading(true);
    setManifestError(null);
    announce('Loading chart options.', { politeness: 'polite' });

    const supabase = createBrowserClient();
    const result = await getUserChartManifest(supabase, phiSubjectUserId);

    if (generation !== manifestLoadGenRef.current) {
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

    setManifest(manifestToChartRows(result.data));
    announce('Chart options loaded.', { politeness: 'polite' });
  }, [announce, phiSubjectUserId]);

  useEffect(() => {
    if (phiScopeLoading) {
      return;
    }
    if (phiSubjectUserId == null) {
      setManifestLoading(false);
      setManifest([]);
      return;
    }
    void loadManifest();
  }, [loadManifest, phiScopeLoading, phiSubjectUserId]);

  const loadChartSeries = useCallback(async () => {
    if (phiSubjectUserId == null || series.length === 0) {
      return;
    }

    const generation = ++chartLoadGenRef.current;
    setChartLoading(true);
    setChartError(null);
    announce('Loading chart data.', { politeness: 'polite' });

    const { p_from, p_to } = insightDateRangeToRpcBounds(dateRange);
    const supabase = createBrowserClient();
    const result = await getChartSeries(supabase, {
      p_user_id: phiSubjectUserId,
      p_series: selectedSeriesToChartSeriesSelection(series),
      p_from,
      p_to,
      p_bucket: bucket,
      p_timezone: patientTimeZone,
    });

    if (generation !== chartLoadGenRef.current) {
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
  }, [announce, bucket, dateRange, patientTimeZone, phiSubjectUserId, series]);

  useEffect(() => {
    if (phiScopeLoading || series.length === 0) {
      chartLoadGenRef.current += 1;
      setChartLoading(false);
      setChartRows([]);
      setChartError(null);
      return;
    }
    void loadChartSeries();
  }, [loadChartSeries, phiScopeLoading, series]);

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

      {!manifestLoading && !manifestError && manifest.length > 0 ? (
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
              onChange={setSeries}
            />
            <InsightDateRangePicker value={dateRange} onChange={setDateRange} />
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
                Chart
              </h3>

              <div
                role="group"
                aria-labelledby={bucketGroupId}
                className="flex flex-wrap gap-2"
              >
                <span id={bucketGroupId} className="sr-only">
                  Time bucket
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
              ) : null}

              <InsightComposedChart
                series={series}
                data={chartRows}
                bucket={bucket}
                loading={chartLoading}
                summary={chartSummary}
                patientTimeZone={patientTimeZone}
                showPatientTimeZoneNote={showPatientTimeZoneNote}
              />
            </section>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
