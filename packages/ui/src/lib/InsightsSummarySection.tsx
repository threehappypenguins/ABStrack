import type { CSSProperties } from 'react';
import type { InsightDateRange } from './InsightDateRangePicker.js';

const OTHER_EPISODE_RGB = '29, 78, 216';
const ABS_EPISODE_RGB = '234, 88, 12';

type EpisodeType = 'ABS' | 'Other';

type HeatmapCell = {
  weekKey: string;
  weekStart: Date;
  label: string;
  count: number;
};

type TimeBucketSummary = {
  label: string;
  otherCount: number;
  absCount: number;
};

/**
 * One overview summary row rendered in the insights header cards.
 */
export interface InsightsSummaryMetrics {
  total_episode_count: number;
  abs_episode_count: number;
  other_episode_count: number;
  average_episodes_per_week: number | null;
  longest_episode_free_streak_days: number | null;
  current_episode_free_streak_days: number | null;
  average_episode_duration_hours: number | null;
}

/**
 * One weekly episode-count bucket used by the overview heatmap.
 */
export interface InsightsWeekCountRow {
  week_start: string;
  episode_type: EpisodeType;
  episode_count: number;
}

/**
 * One hourly episode-start bucket used by the time-of-day chart.
 */
export interface InsightsStartHourDistributionRow {
  hour_of_day: number;
  episode_type: EpisodeType;
  episode_count: number;
}

/**
 * One ranked symptom-frequency row used by the overview symptom chart.
 */
export interface InsightsSymptomFrequencyRow {
  symptom_name: string;
  occurrence_count: number;
}

/**
 * Props for the curated insights overview section shared by patient and practitioner web apps.
 */
export interface InsightsSummarySectionProps {
  dateRange: InsightDateRange;
  timeZone: string;
  summary: InsightsSummaryMetrics | null;
  weekCounts: InsightsWeekCountRow[];
  symptomFrequencies: InsightsSymptomFrequencyRow[];
  startHourDistribution: InsightsStartHourDistributionRow[];
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
}

function formatEpisodeTypeLabel(episodeType: EpisodeType): string {
  return episodeType === 'ABS' ? 'ABS' : 'Other / vomiting';
}

function formatCalendarDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatCompactDateInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatRangeLabel(range: InsightDateRange): string {
  return `${formatCalendarDate(range.from)} to ${formatCalendarDate(range.to)}`;
}

function toStartOfWeek(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  const mondayOffset = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - mondayOffset);
  return copy;
}

function toEndOfWeek(date: Date): Date {
  const copy = toStartOfWeek(date);
  copy.setDate(copy.getDate() + 6);
  return copy;
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function timeZoneDateKey(iso: string, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date(iso));
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function buildHeatmapCells(
  range: InsightDateRange,
  weekCounts: InsightsWeekCountRow[],
  episodeType: EpisodeType,
  timeZone: string,
): HeatmapCell[] {
  const countsByWeek = new Map<string, number>();
  for (const row of weekCounts) {
    if (row.episode_type !== episodeType) {
      continue;
    }
    countsByWeek.set(
      timeZoneDateKey(row.week_start, timeZone),
      row.episode_count,
    );
  }

  const weeks: HeatmapCell[] = [];
  const cursor = toStartOfWeek(range.from);
  const end = toEndOfWeek(range.to);
  while (cursor <= end) {
    const key = dateKey(cursor);
    weeks.push({
      weekKey: key,
      weekStart: new Date(cursor),
      label: formatCalendarDate(cursor),
      count: countsByWeek.get(key) ?? 0,
    });
    cursor.setDate(cursor.getDate() + 7);
  }
  return weeks;
}

function heatmapCellStyle(
  count: number,
  maxCount: number,
  rgb: string,
): CSSProperties {
  if (count <= 0 || maxCount <= 0) {
    return {
      backgroundColor: 'rgba(148, 163, 184, 0.18)',
    };
  }

  const opacity = Math.max(0.2, Math.min(0.9, count / maxCount));
  return {
    backgroundColor: `rgba(${rgb}, ${opacity})`,
  };
}

function buildMonthMarkers(range: InsightDateRange): string[] {
  const markers: string[] = [];
  const cursor = new Date(range.from);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(range.to);
  end.setHours(0, 0, 0, 0);

  while (cursor <= end) {
    const label = cursor.toLocaleDateString(undefined, { month: 'short' });
    if (markers.at(-1) !== label) {
      markers.push(label);
    }
    cursor.setMonth(cursor.getMonth() + 1, 1);
  }

  return markers;
}

function buildTimeBuckets(
  rows: InsightsStartHourDistributionRow[],
): TimeBucketSummary[] {
  const buckets = [
    { label: '12-4a', minHour: 0, maxHour: 3 },
    { label: '4-8a', minHour: 4, maxHour: 7 },
    { label: '8-12p', minHour: 8, maxHour: 11 },
    { label: '12-4p', minHour: 12, maxHour: 15 },
    { label: '4-8p', minHour: 16, maxHour: 19 },
    { label: '8-12a', minHour: 20, maxHour: 23 },
  ];

  return buckets.map((bucket) => {
    let otherCount = 0;
    let absCount = 0;
    for (const row of rows) {
      if (
        row.hour_of_day < bucket.minHour ||
        row.hour_of_day > bucket.maxHour
      ) {
        continue;
      }
      if (row.episode_type === 'ABS') {
        absCount += row.episode_count;
      } else {
        otherCount += row.episode_count;
      }
    }

    return {
      label: bucket.label,
      otherCount,
      absCount,
    };
  });
}

function derivePeakTimeCallout(
  rows: InsightsStartHourDistributionRow[],
): string | null {
  const buckets = buildTimeBuckets(rows);
  const candidates: Array<{
    episodeType: EpisodeType;
    count: number;
    share: number;
    label: string;
  }> = [];

  const otherTotal = buckets.reduce(
    (sum, bucket) => sum + bucket.otherCount,
    0,
  );
  const absTotal = buckets.reduce((sum, bucket) => sum + bucket.absCount, 0);

  for (const bucket of buckets) {
    if (otherTotal > 0) {
      candidates.push({
        episodeType: 'Other',
        count: bucket.otherCount,
        share: bucket.otherCount / otherTotal,
        label: bucket.label,
      });
    }
    if (absTotal > 0) {
      candidates.push({
        episodeType: 'ABS',
        count: bucket.absCount,
        share: bucket.absCount / absTotal,
        label: bucket.label,
      });
    }
  }

  candidates.sort(
    (left, right) => right.share - left.share || right.count - left.count,
  );
  const winner = candidates[0];
  if (!winner || winner.count < 2 || winner.share < 0.45) {
    return null;
  }

  return `${formatEpisodeTypeLabel(winner.episodeType)} episodes most often started around ${winner.label}.`;
}

function deriveClusterCallout(
  weekCounts: InsightsWeekCountRow[],
  timeZone: string,
): string | null {
  const weeklyTotals = new Map<
    string,
    { weekStart: string; total: number; absCount: number }
  >();

  for (const row of weekCounts) {
    const key = timeZoneDateKey(row.week_start, timeZone);
    const current = weeklyTotals.get(key) ?? {
      weekStart: row.week_start,
      total: 0,
      absCount: 0,
    };
    current.total += row.episode_count;
    if (row.episode_type === 'ABS') {
      current.absCount += row.episode_count;
    }
    weeklyTotals.set(key, current);
  }

  const busiestWeek = [...weeklyTotals.values()].sort(
    (left, right) => right.total - left.total || right.absCount - left.absCount,
  )[0];

  if (!busiestWeek || busiestWeek.total < 3) {
    return null;
  }

  const weekLabel = formatCompactDateInTimeZone(
    new Date(busiestWeek.weekStart),
    timeZone,
  );
  const absSuffix =
    busiestWeek.absCount > 0
      ? `, including ${busiestWeek.absCount} ABS episode${busiestWeek.absCount === 1 ? '' : 's'}`
      : '';

  return `Busiest week: ${weekLabel} had ${busiestWeek.total} episode${busiestWeek.total === 1 ? '' : 's'}${absSuffix}.`;
}

function deriveStreakCallout(
  summary: InsightsSummaryMetrics | null,
): string | null {
  if (!summary) {
    return null;
  }

  const longest = summary.longest_episode_free_streak_days ?? 0;
  const current = summary.current_episode_free_streak_days ?? 0;

  if (longest <= 0 && current <= 0) {
    return null;
  }

  if (current >= longest && current > 0) {
    return `Current streak: ${current} day${current === 1 ? '' : 's'} without an episode in this period.`;
  }

  return `Longest episode-free stretch lasted ${longest} day${longest === 1 ? '' : 's'} in this period.`;
}

function buildCallouts(
  summary: InsightsSummaryMetrics | null,
  weekCounts: InsightsWeekCountRow[],
  startHourDistribution: InsightsStartHourDistributionRow[],
  timeZone: string,
): string[] {
  return [
    deriveClusterCallout(weekCounts, timeZone),
    derivePeakTimeCallout(startHourDistribution),
    deriveStreakCallout(summary),
  ].filter((value): value is string => value != null);
}

function formatMetricValue(
  value: number | null | undefined,
  suffix = '',
): string {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: 1,
  })}${suffix}`;
}

function pluralizeDays(days: number | null | undefined): string {
  if (days == null) {
    return '—';
  }
  return `${days.toLocaleString()} day${days === 1 ? '' : 's'}`;
}

/**
 * Curated insights overview with summary cards, auto-generated pattern callouts, a weekly heatmap,
 * symptom ranking, and episode start-time distribution. This sits above the custom chart builder.
 *
 * @param props - Selected date range, overview query results, and load state.
 * @returns Shared patient/practitioner overview content.
 */
export function InsightsSummarySection({
  dateRange,
  timeZone,
  summary,
  weekCounts,
  symptomFrequencies,
  startHourDistribution,
  loading = false,
  error = null,
  emptyMessage = 'No episode or symptom data in this date range yet.',
}: InsightsSummarySectionProps) {
  const hasData =
    (summary?.total_episode_count ?? 0) > 0 ||
    symptomFrequencies.length > 0 ||
    startHourDistribution.length > 0;

  const otherHeatmap = buildHeatmapCells(
    dateRange,
    weekCounts,
    'Other',
    timeZone,
  );
  const absHeatmap = buildHeatmapCells(dateRange, weekCounts, 'ABS', timeZone);
  const maxOtherCount = Math.max(0, ...otherHeatmap.map((cell) => cell.count));
  const maxAbsCount = Math.max(0, ...absHeatmap.map((cell) => cell.count));
  const timeBuckets = buildTimeBuckets(startHourDistribution);
  const maxTimeBucketCount = Math.max(
    0,
    ...timeBuckets.flatMap((bucket) => [bucket.otherCount, bucket.absCount]),
  );
  const strongestSymptomCount = Math.max(
    0,
    ...symptomFrequencies.map((row) => row.occurrence_count),
  );
  const callouts = buildCallouts(
    summary,
    weekCounts,
    startHourDistribution,
    timeZone,
  );
  const monthMarkers = buildMonthMarkers(dateRange);

  return (
    <section aria-labelledby="insights-overview-heading" className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-app-muted">
          Selected period
        </p>
        <h2
          id="insights-overview-heading"
          className="text-xl font-semibold tracking-tight text-app-ink"
        >
          Overview
        </h2>
        <p className="text-sm text-app-muted">{formatRangeLabel(dateRange)}</p>
      </div>

      {loading ? (
        <section
          className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]"
          aria-busy="true"
          aria-label="Loading insights overview"
        >
          <div className="flex items-center gap-3">
            <div
              className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-app-primary border-t-transparent"
              aria-hidden
            />
            <p className="text-sm font-medium text-app-muted">
              Loading overview insights…
            </p>
          </div>
        </section>
      ) : null}

      {!loading && error ? (
        <section
          className="rounded-2xl border border-red-200 bg-red-50 p-6 shadow-soft dark:border-red-900/60 dark:bg-red-950/30"
          role="alert"
          aria-labelledby="insights-overview-error-heading"
        >
          <h3
            id="insights-overview-error-heading"
            className="text-base font-semibold text-red-900 dark:text-red-100"
          >
            Could not load overview insights
          </h3>
          <p className="mt-2 text-sm text-red-800 dark:text-red-200">{error}</p>
        </section>
      ) : null}

      {!loading && !error && !hasData ? (
        <section
          className="rounded-2xl border border-dashed border-app-border bg-app-surface/60 p-6"
          role="status"
        >
          <p className="text-base font-semibold text-app-ink">
            No overview yet
          </p>
          <p className="mt-2 text-sm text-app-muted">{emptyMessage}</p>
        </section>
      ) : null}

      {!loading && !error && hasData ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-2xl border border-app-border/90 bg-app-surface p-4 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
              <p className="text-xs font-medium uppercase tracking-wide text-app-muted">
                Total episodes
              </p>
              <p className="mt-2 text-2xl font-semibold text-app-ink">
                {formatMetricValue(summary?.total_episode_count)}
              </p>
              <p className="mt-1 text-sm text-app-muted">
                {formatMetricValue(summary?.other_episode_count)}{' '}
                other/vomiting, {formatMetricValue(summary?.abs_episode_count)}{' '}
                ABS
              </p>
            </article>

            <article className="rounded-2xl border border-app-border/90 bg-app-surface p-4 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
              <p className="text-xs font-medium uppercase tracking-wide text-app-muted">
                Avg per week
              </p>
              <p className="mt-2 text-2xl font-semibold text-app-ink">
                {formatMetricValue(summary?.average_episodes_per_week)}
              </p>
              <p className="mt-1 text-sm text-app-muted">
                Episodes started during this range
              </p>
            </article>

            <article className="rounded-2xl border border-app-border/90 bg-app-surface p-4 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
              <p className="text-xs font-medium uppercase tracking-wide text-app-muted">
                Longest episode-free stretch
              </p>
              <p className="mt-2 text-2xl font-semibold text-app-ink">
                {pluralizeDays(summary?.longest_episode_free_streak_days)}
              </p>
              <p className="mt-1 text-sm text-app-muted">
                Based on calendar days without overlap
              </p>
            </article>

            <article className="rounded-2xl border border-app-border/90 bg-app-surface p-4 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
              <p className="text-xs font-medium uppercase tracking-wide text-app-muted">
                Current streak
              </p>
              <p className="mt-2 text-2xl font-semibold text-app-ink">
                {pluralizeDays(summary?.current_episode_free_streak_days)}
              </p>
              <p className="mt-1 text-sm text-app-muted">
                Avg duration{' '}
                {formatMetricValue(
                  summary?.average_episode_duration_hours,
                  'h',
                )}
              </p>
            </article>
          </div>

          {callouts.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-3">
              {callouts.map((callout) => (
                <article
                  key={callout}
                  className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-soft dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
                >
                  <p className="font-medium">Pattern callout</p>
                  <p className="mt-2 leading-relaxed">{callout}</p>
                </article>
              ))}
            </div>
          ) : null}

          <article className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-app-ink">
                  Episode calendar
                </h3>
                <p className="mt-1 text-sm text-app-muted">
                  Weekly density across the selected period. Darker cells mean
                  more episodes.
                </p>
              </div>
              <p className="text-xs text-app-muted">
                {monthMarkers.join(' · ')}
              </p>
            </div>

            <div
              className="mt-6 space-y-4"
              role="img"
              aria-label={`Episode calendar from ${formatRangeLabel(
                dateRange,
              )}. ${formatEpisodeTypeLabel('Other')} episodes appear in ${
                otherHeatmap.filter((cell) => cell.count > 0).length
              } weeks. ABS episodes appear in ${
                absHeatmap.filter((cell) => cell.count > 0).length
              } weeks.`}
            >
              {[
                {
                  label: formatEpisodeTypeLabel('Other'),
                  cells: otherHeatmap,
                  maxCount: maxOtherCount,
                  rgb: OTHER_EPISODE_RGB,
                },
                {
                  label: formatEpisodeTypeLabel('ABS'),
                  cells: absHeatmap,
                  maxCount: maxAbsCount,
                  rgb: ABS_EPISODE_RGB,
                },
              ].map((row) => (
                <div
                  key={row.label}
                  className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-start"
                >
                  <p className="text-sm font-medium text-app-ink">
                    {row.label}
                  </p>
                  <div className="flex max-w-full flex-wrap gap-1">
                    {row.cells.map((cell) => (
                      <div
                        key={`${row.label}-${cell.weekKey}`}
                        className="h-6 w-3.5 shrink-0 rounded-md border border-app-border/40"
                        style={heatmapCellStyle(
                          cell.count,
                          row.maxCount,
                          row.rgb,
                        )}
                        aria-hidden
                        title={`${row.label}: ${cell.count} episode${
                          cell.count === 1 ? '' : 's'
                        } in week of ${cell.label}`}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-4 text-xs text-app-muted">
              <span className="inline-flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-sm border border-app-border/40"
                  style={{ backgroundColor: 'rgba(148, 163, 184, 0.18)' }}
                  aria-hidden
                />
                No episodes
              </span>
              <span className="inline-flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-sm border border-app-border/40"
                  style={{ backgroundColor: `rgba(${OTHER_EPISODE_RGB}, 0.7)` }}
                  aria-hidden
                />
                Other / vomiting
              </span>
              <span className="inline-flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-sm border border-app-border/40"
                  style={{ backgroundColor: `rgba(${ABS_EPISODE_RGB}, 0.7)` }}
                  aria-hidden
                />
                ABS
              </span>
            </div>
          </article>

          <div className="grid gap-6 xl:grid-cols-2">
            <article className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
              <h3 className="text-lg font-semibold text-app-ink">
                Symptom frequency
              </h3>
              <p className="mt-1 text-sm text-app-muted">
                Logged symptom observations ranked by frequency for this period.
              </p>

              {symptomFrequencies.length === 0 ? (
                <p className="mt-6 text-sm text-app-muted" role="status">
                  No symptom observations in this date range.
                </p>
              ) : (
                <div className="mt-6 space-y-4">
                  {symptomFrequencies.map((row) => {
                    const width =
                      strongestSymptomCount > 0
                        ? (row.occurrence_count / strongestSymptomCount) * 100
                        : 0;
                    return (
                      <div key={row.symptom_name} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-app-ink">
                            {row.symptom_name}
                          </p>
                          <p className="text-sm text-app-muted">
                            {row.occurrence_count.toLocaleString()}
                          </p>
                        </div>
                        <div
                          className="h-2.5 overflow-hidden rounded-full bg-app-bg"
                          aria-hidden
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${width}%`,
                              backgroundColor: `rgba(${OTHER_EPISODE_RGB}, 0.78)`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </article>

            <article className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
              <h3 className="text-lg font-semibold text-app-ink">
                When episodes start
              </h3>
              <p className="mt-1 text-sm text-app-muted">
                Starts grouped into four-hour windows to make time-of-day
                patterns easier to spot.
              </p>

              {maxTimeBucketCount <= 0 ? (
                <p className="mt-6 text-sm text-app-muted" role="status">
                  No episode starts in this date range.
                </p>
              ) : (
                <div className="mt-6 grid grid-cols-6 gap-3">
                  {timeBuckets.map((bucket) => (
                    <div
                      key={bucket.label}
                      className="flex flex-col items-center gap-3"
                    >
                      <div className="flex h-40 items-end gap-2">
                        <div
                          className="w-4 rounded-t-md"
                          style={{
                            height: `${Math.max(
                              8,
                              (bucket.otherCount / maxTimeBucketCount) * 100,
                            )}%`,
                            backgroundColor: `rgba(${OTHER_EPISODE_RGB}, 0.78)`,
                            opacity: bucket.otherCount > 0 ? 1 : 0.2,
                          }}
                          title={`${formatEpisodeTypeLabel('Other')}: ${
                            bucket.otherCount
                          }`}
                          aria-hidden
                        />
                        <div
                          className="w-4 rounded-t-md"
                          style={{
                            height: `${Math.max(
                              8,
                              (bucket.absCount / maxTimeBucketCount) * 100,
                            )}%`,
                            backgroundColor: `rgba(${ABS_EPISODE_RGB}, 0.78)`,
                            opacity: bucket.absCount > 0 ? 1 : 0.2,
                          }}
                          title={`ABS: ${bucket.absCount}`}
                          aria-hidden
                        />
                      </div>
                      <div className="space-y-1 text-center">
                        <p className="text-xs font-medium text-app-ink">
                          {bucket.label}
                        </p>
                        <p className="text-[11px] text-app-muted">
                          {bucket.otherCount + bucket.absCount} total
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-4 text-xs text-app-muted">
                <span className="inline-flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-sm"
                    style={{
                      backgroundColor: `rgba(${OTHER_EPISODE_RGB}, 0.78)`,
                    }}
                    aria-hidden
                  />
                  Other / vomiting
                </span>
                <span className="inline-flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-sm"
                    style={{
                      backgroundColor: `rgba(${ABS_EPISODE_RGB}, 0.78)`,
                    }}
                    aria-hidden
                  />
                  ABS
                </span>
              </div>
            </article>
          </div>
        </>
      ) : null}
    </section>
  );
}
