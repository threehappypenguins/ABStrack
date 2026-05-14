'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

const WEEK_LABELS = [
  'Jan 1',
  'Jan 8',
  'Jan 15',
  'Jan 22',
  'Jan 29',
  'Feb 5',
  'Feb 12',
  'Feb 19',
  'Feb 26',
  'Mar 5',
  'Mar 12',
  'Mar 19',
];

/**
 * Parses a Tailwind-style RGB channel token (`R G B`) from the document root.
 *
 * @param cssVar - Custom property name including leading `--`.
 * @param alpha - Alpha channel 0–1.
 * @returns CSS `rgba(...)` string.
 */
function rgbaFromCssVar(cssVar: string, alpha: number): string {
  if (typeof document === 'undefined') {
    return `rgba(0,0,0,${alpha})`;
  }
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(cssVar)
    .trim();
  const parts = raw.split(/\s+/).map(Number);
  if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
  }
  return `rgba(0,0,0,${alpha})`;
}

function subscribeDarkClass(onChange: () => void) {
  const el = document.documentElement;
  const mo = new MutationObserver(onChange);
  mo.observe(el, { attributes: true, attributeFilter: ['class'] });
  return () => mo.disconnect();
}

function getDarkClassSnapshot() {
  return document.documentElement.classList.contains('dark');
}

function getDarkClassServerSnapshot() {
  return false;
}

/**
 * Fake dashboard chart bundle for the public landing page (illustrative data only).
 *
 * @returns Chart preview panel.
 */
export function LandingDashboardCharts() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const isDark = useSyncExternalStore(
    subscribeDarkClass,
    getDarkClassSnapshot,
    getDarkClassServerSnapshot,
  );
  const chartsRef = useRef<Chart[]>([]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) {
      return;
    }

    chartsRef.current.forEach((c) => c.destroy());
    chartsRef.current = [];

    const gridColor = rgbaFromCssVar('--app-border', isDark ? 0.35 : 0.12);
    const tickColor = rgbaFromCssVar('--app-muted', 1);
    const primary = rgbaFromCssVar('--app-primary', 1);
    const primarySoft = rgbaFromCssVar('--app-primary-soft', 0.45);
    const accentGreen = isDark ? 'rgb(74, 222, 128)' : 'rgb(29, 158, 117)';

    const canvasFreq = wrap.querySelector<HTMLCanvasElement>(
      '#landing-freq-chart',
    );
    const canvasDonut = wrap.querySelector<HTMLCanvasElement>(
      '#landing-donut-chart',
    );
    const canvasLine = wrap.querySelector<HTMLCanvasElement>(
      '#landing-line-chart',
    );
    if (!canvasFreq || !canvasDonut || !canvasLine) {
      return;
    }

    const c1 = new Chart(canvasFreq, {
      type: 'bar',
      data: {
        labels: WEEK_LABELS,
        datasets: [
          {
            label: 'ABS',
            data: [2, 3, 2, 4, 6, 3, 4, 3, 6, 4, 3, 2],
            backgroundColor: primary,
            borderRadius: 3,
          },
          {
            label: 'Other',
            data: [1, 0, 2, 1, 1, 2, 0, 1, 2, 1, 0, 1],
            backgroundColor: primarySoft,
            borderRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { left: 0, right: 4, top: 0, bottom: 0 } },
        plugins: { legend: { display: false } },
        scales: {
          x: {
            stacked: true,
            grid: { color: gridColor },
            ticks: {
              color: tickColor,
              font: { size: 9 },
              maxRotation: 45,
              autoSkip: true,
              maxTicksLimit: 10,
            },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: { color: gridColor },
            ticks: {
              color: tickColor,
              font: { size: 10 },
              stepSize: 2,
            },
          },
        },
      },
    });

    const c2 = new Chart(canvasDonut, {
      type: 'doughnut',
      data: {
        labels: ['ABS', 'Other'],
        datasets: [
          {
            data: [68, 32],
            backgroundColor: [primary, accentGreen],
            borderWidth: 0,
            hoverOffset: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        cutout: '65%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) =>
                ctx.label ? ` ${ctx.label}: ${ctx.raw as number}%` : '',
            },
          },
        },
      },
    });

    const bacData = [
      0.06, 0.08, 0.07, 0.1, 0.14, 0.09, 0.11, 0.09, 0.15, 0.12, 0.1, 0.08,
    ];
    const glucoseData = [
      5.8, 6.4, 5.5, 6.7, 5.9, 6.2, 6.8, 5.6, 6.1, 6.9, 5.7, 6.3,
    ];

    const c3 = new Chart(canvasLine, {
      type: 'line',
      data: {
        labels: WEEK_LABELS,
        datasets: [
          {
            label: 'BAC %',
            data: bacData,
            borderColor: primary,
            backgroundColor: primarySoft,
            borderWidth: 2,
            tension: 0.4,
            pointRadius: 3,
            pointBackgroundColor: primary,
            fill: true,
            yAxisID: 'y',
          },
          {
            label: 'Glucose',
            data: glucoseData,
            borderColor: accentGreen,
            borderWidth: 2,
            tension: 0.4,
            pointRadius: 3,
            pointBackgroundColor: accentGreen,
            borderDash: [4, 3],
            fill: false,
            yAxisID: 'y2',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { left: 0, right: 10, top: 0, bottom: 0 } },
        plugins: { legend: { display: false } },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: {
              color: tickColor,
              font: { size: 9 },
              maxRotation: 45,
              autoSkip: true,
              maxTicksLimit: 10,
            },
          },
          y: {
            position: 'left',
            min: 0,
            max: 0.2,
            grid: { color: gridColor },
            ticks: {
              color: primary,
              font: { size: 10 },
              callback: (v) => `${Number(v).toFixed(2)}%`,
            },
          },
          y2: {
            position: 'right',
            min: 4.5,
            max: 7.5,
            grid: { display: false },
            ticks: {
              color: accentGreen,
              font: { size: 10 },
              callback: (v) => Number(v).toFixed(1),
            },
          },
        },
      },
    });

    chartsRef.current = [c1, c2, c3];

    const resizeCharts = () => {
      chartsRef.current.forEach((c) => {
        c.resize();
      });
    };
    const resizeObserver = new ResizeObserver(() => {
      resizeCharts();
    });
    resizeObserver.observe(wrap);
    resizeCharts();

    return () => {
      resizeObserver.disconnect();
      chartsRef.current.forEach((c) => c.destroy());
      chartsRef.current = [];
    };
  }, [isDark]);

  return (
    <div
      ref={wrapRef}
      className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-7"
    >
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[15px] font-medium text-app-ink">
            ABStrack — Episode &amp; health report (sample)
          </p>
          <p className="mt-0.5 text-xs text-app-muted">
            Jan 1 – Mar 19, 2026 · 12-week summary · illustrative only
          </p>
        </div>
        <span className="inline-flex w-fit shrink-0 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">
          Active monitoring
        </span>
      </div>

      <div className="mb-3.5 grid min-w-0 grid-cols-2 gap-2.5 lg:grid-cols-4">
        <MetricCard
          label="Total episodes"
          value="47"
          delta="↑ 8 vs prior period"
          deltaTone="up"
        />
        <MetricCard
          label="Avg BAC at peak"
          value="0.11%"
          delta="↑ 0.02% vs prior"
          deltaTone="up"
        />
        <MetricCard
          label="Avg blood glucose"
          value="6.1 mmol/L"
          delta="↓ 0.2 vs prior"
          deltaTone="down"
        />
        <MetricCard
          label="Symptom types logged"
          value="9"
          delta="unique symptoms"
          deltaTone="neutral"
        />
      </div>

      <div className="mb-3.5 grid min-w-0 grid-cols-1 gap-3.5 sm:grid-cols-2">
        <div className="min-w-0 overflow-hidden rounded-xl border border-app-border/80 bg-app-surface px-3 py-4 sm:px-4">
          <p className="mb-3 text-[13px] font-medium text-app-ink">
            Episode frequency — weekly
          </p>
          <div className="mb-2 flex flex-wrap gap-3 text-[11px] text-app-muted">
            <span>
              <span
                className="mr-1 inline-block size-2 rounded-sm bg-app-primary align-middle"
                aria-hidden
              />
              ABS episodes
            </span>
            <span>
              <span
                className="mr-1 inline-block size-2 rounded-sm bg-app-primary-soft/50 align-middle"
                aria-hidden
              />
              Other episodes
            </span>
          </div>
          <div className="relative h-40 w-full min-w-0">
            <canvas
              id="landing-freq-chart"
              role="img"
              aria-label="Sample weekly episode frequency bar chart from January through March 2026. Stacked ABS and other episode counts per week."
            />
          </div>
        </div>

        <div className="min-w-0 overflow-hidden rounded-xl border border-app-border/80 bg-app-surface px-3 py-4 sm:px-4">
          <p className="mb-3 text-[13px] font-medium text-app-ink">
            Episode type breakdown
          </p>
          <div className="mb-2 flex flex-wrap gap-3 text-[11px] text-app-muted">
            <span>
              <span
                className="mr-1 inline-block size-2 rounded-sm bg-app-primary align-middle"
                aria-hidden
              />
              ABS 68%
            </span>
            <span>
              <span
                className="mr-1 inline-block size-2 rounded-sm bg-emerald-500/70 align-middle"
                aria-hidden
              />
              Other 32%
            </span>
          </div>
          <div className="relative flex h-40 w-full min-w-0 items-center justify-center">
            <canvas
              id="landing-donut-chart"
              role="img"
              aria-label="Sample donut chart: 68 percent ABS episodes, 32 percent other."
            />
          </div>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-3.5 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="min-w-0 overflow-hidden rounded-xl border border-app-border/80 bg-app-surface px-3 py-4 sm:px-4">
          <p className="mb-3 text-[13px] font-medium text-app-ink">
            BAC &amp; blood glucose over time
          </p>
          <div className="mb-2 flex flex-wrap gap-3 text-[11px] text-app-muted">
            <span>
              <span
                className="mr-1 inline-block size-2 rounded-sm bg-app-primary align-middle"
                aria-hidden
              />
              BAC %
            </span>
            <span>
              <span
                className="mr-1 inline-block size-2 rounded-sm bg-emerald-600 align-middle dark:bg-emerald-400"
                aria-hidden
              />
              Blood glucose (mmol/L)
            </span>
          </div>
          <div className="relative h-44 w-full min-w-0">
            <canvas
              id="landing-line-chart"
              role="img"
              aria-label="Sample dual-axis line chart of BAC percent and blood glucose over twelve weeks. Values are fictional."
            />
          </div>
        </div>

        <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-app-border/80 bg-app-surface px-3 py-4 sm:px-4">
          <p className="mb-3 text-[13px] font-medium text-app-ink">
            Top symptoms logged
          </p>
          <div className="min-h-0 min-w-0 flex-1 space-y-1.5">
            <SymptomRow
              name="Nausea"
              barClass="w-[88%]"
              count={41}
              tone="strong"
            />
            <SymptomRow
              name="Dizziness"
              barClass="w-[75%]"
              count={35}
              tone="strong"
            />
            <SymptomRow
              name="Slurred speech"
              barClass="w-[60%]"
              count={28}
              tone="mid"
            />
            <SymptomRow
              name="Fatigue"
              barClass="w-[52%]"
              count={24}
              tone="mid"
            />
            <SymptomRow
              name="Vomiting"
              barClass="w-[40%]"
              count={19}
              tone="soft"
            />
            <SymptomRow
              name="Cognitive fog"
              barClass="w-[32%]"
              count={15}
              tone="soft"
            />
            <SymptomRow
              name="Vertigo"
              barClass="w-[22%]"
              count={10}
              tone="faint"
            />
          </div>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-app-muted">
        Figures use fictional data to preview reporting; ABStrack does not
        display your health data on this page.
      </p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  delta,
  deltaTone,
}: {
  label: string;
  value: string;
  delta: string;
  deltaTone: 'up' | 'down' | 'neutral';
}) {
  const deltaClass =
    deltaTone === 'up'
      ? 'text-red-700 dark:text-red-300'
      : deltaTone === 'down'
        ? 'text-emerald-800 dark:text-emerald-300'
        : 'text-app-muted';
  return (
    <div className="min-w-0 rounded-lg bg-app-bg/80 px-3 py-2.5 dark:bg-app-bg/40 sm:px-3.5 sm:py-3">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-app-muted">
        {label}
      </p>
      <p className="text-[22px] font-medium text-app-ink">{value}</p>
      <p className={`mt-0.5 text-[11px] ${deltaClass}`}>{delta}</p>
    </div>
  );
}

function SymptomRow({
  name,
  barClass,
  count,
  tone,
}: {
  name: string;
  barClass: string;
  count: number;
  tone: 'strong' | 'mid' | 'soft' | 'faint';
}) {
  const bar =
    tone === 'strong'
      ? 'bg-app-primary'
      : tone === 'mid'
        ? 'bg-app-primary/80'
        : tone === 'soft'
          ? 'bg-app-primary/55 dark:bg-app-primary-soft/60'
          : 'border border-app-primary/35 bg-app-primary/45 dark:border-app-border dark:bg-app-primary-soft/25';
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,3.75rem)_minmax(0,1fr)_auto] items-center gap-1.5 text-xs sm:grid-cols-[minmax(0,5.25rem)_minmax(0,1fr)_auto] sm:gap-2">
      <span className="truncate text-app-muted" title={name}>
        {name}
      </span>
      <div className="h-1.5 min-w-0 overflow-hidden rounded-full bg-app-bg dark:bg-app-border/40">
        <div className={`h-full rounded-full ${bar} ${barClass}`} />
      </div>
      <span className="min-w-0 text-right text-[11px] text-app-muted tabular-nums">
        {count}
      </span>
    </div>
  );
}
