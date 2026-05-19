'use client';

import { Fragment, useId, useMemo, type ReactNode } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  assignInsightChartYAxes,
  buildInsightChartTableColumns,
  chartSeriesBpBandKey,
  enrichInsightChartDataForBloodPressure,
  getInsightChartUnsupportedMessage,
  chartSeriesDiastolicAvgKey,
  chartSeriesSystolicAvgKey,
  chartSeriesValueAvgKey,
  flattenChartSeriesRows,
  formatInsightChartBucketLabel,
  formatInsightChartPatientTimeZoneNote,
  formatInsightChartTableCell,
  readInsightChartTableMetric,
  type InsightValueYAxisId,
} from './insight-composed-chart-utils.js';
import type {
  ChartSeriesRow,
  InsightComposedChartProps,
} from './InsightComposedChart.types.js';
import type { SelectedSeries } from './InsightSeriesPicker.types.js';

export type {
  ChartSeriesBucketMetrics,
  ChartSeriesRow,
  InsightChartBucket,
  InsightComposedChartProps,
} from './InsightComposedChart.types.js';

const CHART_PERIOD_TABLE_CAPTION: Record<
  InsightComposedChartProps['bucket'],
  string
> = {
  day: 'day',
  week: 'week',
  month: 'month',
};

const CHART_HEIGHT_PX = 320;

function yAxisLabelForUnit(
  series: SelectedSeries[],
  yAxisAssignments: Map<string, InsightValueYAxisId | null>,
  axisId: InsightValueYAxisId,
): string | undefined {
  if (axisId === 'bp') {
    const bp = series.find((item) => item.chartType === 'bp_band');
    return bp?.unit ?? 'mmHg';
  }

  const match = series.find((item) => {
    if (item.chartType === 'event' || item.chartType === 'bp_band') {
      return false;
    }
    return yAxisAssignments.get(item.seriesId) === axisId;
  });

  if (!match) {
    return undefined;
  }

  if (match.responseType === 'severity') {
    return 'Severity';
  }

  return match.unit ?? undefined;
}

function renderValueSeries(
  item: SelectedSeries,
  yAxisId: InsightValueYAxisId,
): ReactNode {
  const valueKey = chartSeriesValueAvgKey(item.seriesId);
  const common = {
    name: item.label,
    dataKey: valueKey,
    yAxisId,
    stroke: item.color,
    fill: item.color,
    isAnimationActive: false,
  } as const;

  switch (item.chartType) {
    case 'line':
      return (
        <Line
          key={item.seriesId}
          {...common}
          type="monotone"
          dot={{ r: 3, fill: item.color }}
          connectNulls
        />
      );
    case 'bar':
      return <Bar key={item.seriesId} {...common} />;
    case 'scatter':
      return (
        <Scatter
          key={item.seriesId}
          {...common}
          fill={item.color}
          legendType="circle"
          shape="circle"
        />
      );
    default:
      return null;
  }
}

function renderBloodPressureBand(item: SelectedSeries): ReactNode {
  const systolicKey = chartSeriesSystolicAvgKey(item.seriesId);
  const diastolicKey = chartSeriesDiastolicAvgKey(item.seriesId);
  const bandKey = chartSeriesBpBandKey(item.seriesId);

  return (
    <>
      <Area
        key={`${item.seriesId}-area`}
        type="monotone"
        dataKey={bandKey}
        yAxisId="bp"
        stroke="none"
        fill={item.color}
        fillOpacity={0.2}
        dot={false}
        activeDot={false}
        isAnimationActive={false}
        connectNulls
      />
      <Line
        key={`${item.seriesId}-systolic`}
        type="monotone"
        dataKey={systolicKey}
        yAxisId="bp"
        name={`${item.label} (systolic)`}
        stroke={item.color}
        dot={false}
        connectNulls
        isAnimationActive={false}
      />
      <Line
        key={`${item.seriesId}-diastolic`}
        type="monotone"
        dataKey={diastolicKey}
        yAxisId="bp"
        name={`${item.label} (diastolic)`}
        stroke={item.color}
        strokeDasharray="4 3"
        dot={false}
        connectNulls
        isAnimationActive={false}
      />
    </>
  );
}

function renderEventMarkers(
  item: SelectedSeries,
  data: ChartSeriesRow[],
): ReactNode[] {
  return data
    .filter((row) => {
      const count = row.series[item.seriesId]?.event_count;
      return count !== null && count !== undefined && count > 0;
    })
    .map((row) => (
      <ReferenceLine
        key={`${item.seriesId}-${row.bucketStart}`}
        x={row.bucketStart}
        stroke={item.color}
        strokeWidth={2}
        strokeOpacity={0.85}
        ifOverflow="visible"
        label={{
          value: item.label,
          position: 'insideTop',
          fill: item.color,
          fontSize: 10,
        }}
      />
    ));
}

/**
 * Accessible multi-series insight chart (web only) using Recharts `ComposedChart`.
 * Renders server-prepared bucketed series with a figcaption summary and data table.
 *
 * @param props - Selected series manifest, pivoted bucket rows, bucket size, loading flag, and summary.
 * @returns Chart figure with visually hidden tabular alternative.
 */
export function InsightComposedChart({
  series,
  data,
  bucket,
  loading,
  summary,
  patientTimeZone,
  showPatientTimeZoneNote = false,
  patientTimeZoneNoteUsesPatientLocal = false,
}: InsightComposedChartProps) {
  const chartData = useMemo(
    () =>
      enrichInsightChartDataForBloodPressure(
        flattenChartSeriesRows(data),
        series,
      ),
    [data, series],
  );
  const yAxisAssignments = useMemo(
    () => assignInsightChartYAxes(series),
    [series],
  );
  const tableColumns = useMemo(
    () => buildInsightChartTableColumns(series),
    [series],
  );
  const unsupportedMessage = useMemo(
    () => getInsightChartUnsupportedMessage(series),
    [series],
  );

  const usesLeftAxis = [...yAxisAssignments.values()].includes('left');
  const usesRightAxis = [...yAxisAssignments.values()].includes('right');
  const usesBpAxis = [...yAxisAssignments.values()].includes('bp');

  const bucketTickFormatter = useMemo(
    () => (value: string) =>
      formatInsightChartBucketLabel(value, bucket, patientTimeZone),
    [bucket, patientTimeZone],
  );
  const summaryId = `${useId().replace(/:/g, '')}-summary`;

  const chartTooltipStyle = {
    backgroundColor: 'rgb(var(--app-surface) / 1)',
    borderColor: 'rgb(var(--app-border) / 1)',
    color: 'rgb(var(--app-ink) / 1)',
  } as const;

  return (
    <div className="space-y-3 text-app-ink">
      <figure
        aria-busy={loading ? true : undefined}
        aria-labelledby={summaryId}
        className="rounded-xl border border-app-border bg-app-surface p-4"
      >
        <figcaption id={summaryId} className="mb-3 text-sm text-app-ink">
          {summary}
        </figcaption>

        {showPatientTimeZoneNote ? (
          <p className="mb-3 text-xs text-app-muted">
            {formatInsightChartPatientTimeZoneNote(patientTimeZone, {
              patientLocal: patientTimeZoneNoteUsesPatientLocal,
            })}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-app-muted" role="status">
            Loading chart…
          </p>
        ) : unsupportedMessage ? (
          <p className="text-sm text-app-muted" role="alert">
            {unsupportedMessage}
          </p>
        ) : (
          <div
            className="h-80 w-full min-w-0"
            aria-hidden={chartData.length === 0}
          >
            <ResponsiveContainer width="100%" height={CHART_HEIGHT_PX}>
              <ComposedChart
                data={chartData}
                margin={{ top: 12, right: 16, bottom: 8, left: 8 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-app-border"
                />
                <XAxis
                  dataKey="bucketStart"
                  tickFormatter={bucketTickFormatter}
                  tick={{ fill: 'currentColor', fontSize: 12 }}
                />
                {usesLeftAxis ? (
                  <YAxis
                    yAxisId="left"
                    orientation="left"
                    tick={{ fill: 'currentColor', fontSize: 12 }}
                    label={{
                      value: yAxisLabelForUnit(
                        series,
                        yAxisAssignments,
                        'left',
                      ),
                      angle: -90,
                      position: 'insideLeft',
                    }}
                  />
                ) : null}
                {usesRightAxis ? (
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fill: 'currentColor', fontSize: 12 }}
                    label={{
                      value: yAxisLabelForUnit(
                        series,
                        yAxisAssignments,
                        'right',
                      ),
                      angle: 90,
                      position: 'insideRight',
                    }}
                  />
                ) : null}
                {usesBpAxis ? (
                  <YAxis
                    yAxisId="bp"
                    orientation="left"
                    tick={{ fill: 'currentColor', fontSize: 12 }}
                    label={{
                      value: yAxisLabelForUnit(series, yAxisAssignments, 'bp'),
                      angle: -90,
                      position: 'insideLeft',
                    }}
                  />
                ) : null}
                <Tooltip
                  labelFormatter={(label) => bucketTickFormatter(String(label))}
                  contentStyle={chartTooltipStyle}
                  labelStyle={{ color: 'rgb(var(--app-ink) / 1)' }}
                  itemStyle={{ color: 'rgb(var(--app-ink) / 1)' }}
                />
                {series.map((item) => {
                  if (item.chartType === 'bp_band') {
                    return (
                      <Fragment key={item.seriesId}>
                        {renderBloodPressureBand(item)}
                      </Fragment>
                    );
                  }
                  if (item.chartType === 'event') {
                    return (
                      <Fragment key={item.seriesId}>
                        {renderEventMarkers(item, data)}
                      </Fragment>
                    );
                  }
                  const yAxisId = yAxisAssignments.get(item.seriesId);
                  if (!yAxisId) {
                    return null;
                  }
                  return renderValueSeries(item, yAxisId);
                })}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {!loading && !unsupportedMessage && chartData.length === 0 ? (
          <p className="mt-2 text-sm text-app-muted">No data for this range.</p>
        ) : null}
      </figure>

      <table className="sr-only">
        <caption>
          Detailed chart data grouped by {CHART_PERIOD_TABLE_CAPTION[bucket]}
        </caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {tableColumns.map((column) => (
              <th key={column.id} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.bucketStart}>
              <th scope="row">
                {formatInsightChartBucketLabel(
                  row.bucketStart,
                  bucket,
                  patientTimeZone,
                )}
              </th>
              {tableColumns.map((column) => {
                const selected = series.find(
                  (item) => item.seriesId === column.seriesId,
                );
                const metric = readInsightChartTableMetric(row, column);
                return (
                  <td key={column.id}>
                    {column.kind === 'event_count'
                      ? formatInsightChartTableCell(metric)
                      : formatInsightChartTableCell(metric, selected?.unit)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
