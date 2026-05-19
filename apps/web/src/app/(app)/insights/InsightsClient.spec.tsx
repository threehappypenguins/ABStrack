import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { LiveAnnouncerProvider } from '@abstrack/ui/a11y-web';
import type {
  ChartManifestRow,
  InsightDateRange,
  SelectedSeries,
} from '@abstrack/ui';
import {
  getChartSeries,
  getUserChartManifest,
  listUnseenChartSnapshotsForPatient,
  markChartSnapshotSeen,
} from '@abstrack/supabase';
import {
  getDefaultInsightDateRange,
  insightDateRangeToRpcBounds,
} from '../../../lib/insights/insight-chart-params';
import { InsightsClient } from './InsightsClient';

const PHI_SUBJECT_A = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PHI_SUBJECT_B = 'bbbbbbbb-bbbb-cccc-dddd-ffffffffffff';

const phiContext = {
  authUserId: PHI_SUBJECT_A,
  phiSubjectUserId: PHI_SUBJECT_A as string | null,
  profileAppRole: 'patient' as const,
  loading: false,
  errorMessage: null as string | null,
  refresh: jest.fn(),
};

const bacManifestRow: ChartManifestRow = {
  series_id: 'health_marker::bac',
  series_type: 'health_marker',
  label: 'BAC',
  response_type: 'numeric',
  is_blood_pressure: false,
  unit: '%',
  observation_count: 3,
  first_observed_at: '2026-01-01T00:00:00.000Z',
  last_observed_at: '2026-02-01T00:00:00.000Z',
};

const announceMock = jest.fn();

jest.mock('../../../lib/patient/use-web-phi-subject-user-context', () => ({
  useWebPhiSubjectUserContext: () => phiContext,
}));

jest.mock('@abstrack/ui/a11y-web', () => ({
  ...jest.requireActual('@abstrack/ui/a11y-web'),
  useAnnounce: () => ({ announce: announceMock }),
}));

jest.mock('../../../lib/supabase/browser-client', () => ({
  createBrowserClient: () => ({}),
}));

jest.mock('@abstrack/supabase', () => ({
  getUserChartManifest: jest.fn(),
  getChartSeries: jest.fn(),
  listUnseenChartSnapshotsForPatient: jest.fn(),
  markChartSnapshotSeen: jest.fn(),
}));

jest.mock('@abstrack/ui', () => {
  // Six `../` from `apps/web/src/app/(app)/insights` to the repo root, then `packages/ui`.
  const uiLib = '../../../../../../packages/ui/src/lib';
  const { getInsightDateRangePreset } = jest.requireActual(
    `${uiLib}/insight-date-range-picker-utils`,
  );
  const { pivotChartSeriesBucketRows } = jest.requireActual(
    `${uiLib}/insight-composed-chart-utils`,
  );
  const { filterChartableManifestRows, reconcileSelectedSeriesWithManifest } =
    jest.requireActual(`${uiLib}/insight-series-picker-utils`);
  return {
    getInsightDateRangePreset,
    pivotChartSeriesBucketRows,
    filterChartableManifestRows,
    reconcileSelectedSeriesWithManifest,
    Button: ({
      children,
      onPress,
      accessibilityLabel,
    }: {
      children: ReactNode;
      onPress?: () => void;
      accessibilityLabel?: string;
    }) => (
      <button type="button" aria-label={accessibilityLabel} onClick={onPress}>
        {children}
      </button>
    ),
    InsightSeriesPicker: ({
      manifest,
      value,
      onChange,
    }: {
      manifest: ChartManifestRow[];
      value: unknown[];
      onChange: (next: unknown[]) => void;
    }) => (
      <div>
        {manifest.map((row) => (
          <span
            key={row.series_id}
            data-testid={`manifest-label-${row.series_id}`}
          >
            {row.label}
          </span>
        ))}
        <button
          type="button"
          onClick={() => {
            const row = manifest[0];
            if (!row) {
              return;
            }
            const selected: SelectedSeries = {
              seriesId: row.series_id,
              seriesType: row.series_type,
              responseType: row.response_type as 'numeric',
              isBloodPressure: row.is_blood_pressure,
              label: row.label,
              unit: row.unit,
              chartType: 'line',
              color: '#1d4ed8',
            };
            onChange([selected]);
          }}
        >
          Select first series
        </button>
        <span data-testid="selected-count">{value.length}</span>
      </div>
    ),
    InsightDateRangePicker: ({
      onChange,
    }: {
      onChange: (next: InsightDateRange) => void;
    }) => (
      <div data-testid="date-range-picker">
        <button
          type="button"
          onClick={() =>
            onChange({
              from: new Date(2026, 0, 1),
              to: new Date(2026, 0, 31),
            })
          }
        >
          Set January 2026 range
        </button>
      </div>
    ),
    InsightComposedChart: ({
      summary,
      loading,
    }: {
      summary: string;
      loading: boolean;
    }) => (
      <div data-testid="composed-chart">
        <p>{summary}</p>
        {loading ? <p role="status">Chart loading</p> : null}
      </div>
    ),
  };
});

const getUserChartManifestMock = getUserChartManifest as jest.MockedFunction<
  typeof getUserChartManifest
>;
const getChartSeriesMock = getChartSeries as jest.MockedFunction<
  typeof getChartSeries
>;
const listUnseenChartSnapshotsForPatientMock =
  listUnseenChartSnapshotsForPatient as jest.MockedFunction<
    typeof listUnseenChartSnapshotsForPatient
  >;
const markChartSnapshotSeenMock = markChartSnapshotSeen as jest.MockedFunction<
  typeof markChartSnapshotSeen
>;

const SHARED_SNAPSHOT_ID = 'cccccccc-bbbb-cccc-dddd-111111111111';
const SHARED_SNAPSHOT = {
  id: SHARED_SNAPSHOT_ID,
  patient_user_id: PHI_SUBJECT_A,
  practitioner_user_id: 'dddddddd-bbbb-cccc-dddd-222222222222',
  series_definition: [
    {
      seriesId: 'health_marker::bac',
      seriesType: 'health_marker' as const,
      responseType: 'numeric' as const,
      isBloodPressure: false,
      label: 'BAC',
      unit: '%',
      chartType: 'line' as const,
      color: '#1d4ed8',
    },
  ],
  date_from: '2026-01-01T05:00:00.000Z',
  date_to: '2026-02-01T05:00:00.000Z',
  bucket: 'week' as const,
  practitioner_note: 'Please review this trend.',
  created_at: '2026-05-01T12:00:00.000Z',
  seen_by_patient_at: null,
};

function renderInsights() {
  return render(
    <LiveAnnouncerProvider>
      <InsightsClient />
    </LiveAnnouncerProvider>,
  );
}

describe('InsightsClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    phiContext.authUserId = PHI_SUBJECT_A;
    phiContext.phiSubjectUserId = PHI_SUBJECT_A;
    phiContext.loading = false;
    phiContext.errorMessage = null;
    getUserChartManifestMock.mockResolvedValue({
      ok: true,
      data: [bacManifestRow],
    });
    getChartSeriesMock.mockResolvedValue({
      ok: true,
      data: [
        {
          series_id: bacManifestRow.series_id,
          bucket_start: '2026-01-15T00:00:00.000Z',
          value_avg: 0.02,
          value_min: 0.02,
          value_max: 0.02,
          systolic_avg: null,
          diastolic_avg: null,
          event_count: null,
        },
      ],
    });
    listUnseenChartSnapshotsForPatientMock.mockResolvedValue({
      ok: true,
      data: [],
    });
    markChartSnapshotSeenMock.mockResolvedValue({ ok: true, data: true });
  });

  it('does not show the empty state when PHI scope fails to resolve', async () => {
    phiContext.phiSubjectUserId = null;
    phiContext.errorMessage = 'Could not resolve patient context.';

    renderInsights();

    expect(
      await screen.findByText('Could not resolve patient context.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        'No data to chart yet. Log some episodes or health markers to get started.',
      ),
    ).not.toBeInTheDocument();
    expect(getUserChartManifestMock).not.toHaveBeenCalled();
  });

  it('shows the empty state when the manifest is empty', async () => {
    getUserChartManifestMock.mockResolvedValue({ ok: true, data: [] });

    renderInsights();

    expect(
      await screen.findByText(
        'No data to chart yet. Log some episodes or health markers to get started.',
      ),
    ).toBeInTheDocument();
    expect(getChartSeriesMock).not.toHaveBeenCalled();
  });

  it('shows the empty state when the manifest has only non-chartable rows', async () => {
    getUserChartManifestMock.mockResolvedValue({
      ok: true,
      data: [
        {
          series_id: 'symptom::journal::text',
          series_type: 'symptom',
          label: 'Journal',
          response_type: 'text',
          is_blood_pressure: false,
          unit: null,
          observation_count: 2,
          first_observed_at: '2026-01-01T00:00:00.000Z',
          last_observed_at: '2026-02-01T00:00:00.000Z',
        },
      ],
    });

    renderInsights();

    expect(
      await screen.findByText(
        'No data to chart yet. Log some episodes or health markers to get started.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('date-range-picker')).not.toBeInTheDocument();
    expect(getChartSeriesMock).not.toHaveBeenCalled();
  });

  it('does not call getChartSeries until a series is selected', async () => {
    renderInsights();

    await screen.findByTestId('date-range-picker');
    expect(getChartSeriesMock).not.toHaveBeenCalled();
  });

  it('discards stale manifest when PHI subject changes before RPC completes', async () => {
    let resolveManifest:
      | ((value: Awaited<ReturnType<typeof getUserChartManifest>>) => void)
      | undefined;
    getUserChartManifestMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveManifest = resolve;
        }),
    );

    const view = renderInsights();

    expect(
      await screen.findByText('Loading chart options…'),
    ).toBeInTheDocument();

    phiContext.phiSubjectUserId = PHI_SUBJECT_B;
    phiContext.loading = true;
    view.rerender(
      <LiveAnnouncerProvider>
        <InsightsClient />
      </LiveAnnouncerProvider>,
    );

    await act(async () => {
      resolveManifest?.({
        ok: true,
        data: [
          {
            ...bacManifestRow,
            label: 'bac',
          },
        ],
      });
      await Promise.resolve();
    });

    expect(
      screen.queryByTestId('manifest-label-health_marker::bac'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Chart options loaded.')).not.toBeInTheDocument();
  });

  it('does not announce or apply manifest after unmount when RPC completes late', async () => {
    let resolveManifest:
      | ((value: Awaited<ReturnType<typeof getUserChartManifest>>) => void)
      | undefined;
    getUserChartManifestMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveManifest = resolve;
        }),
    );

    const view = renderInsights();

    expect(
      await screen.findByText('Loading chart options…'),
    ).toBeInTheDocument();
    announceMock.mockClear();
    view.unmount();

    await act(async () => {
      resolveManifest?.({ ok: true, data: [bacManifestRow] });
      await Promise.resolve();
    });

    expect(announceMock).not.toHaveBeenCalled();
  });

  it('maps raw RPC health marker labels to preset display names', async () => {
    getUserChartManifestMock.mockResolvedValue({
      ok: true,
      data: [
        {
          ...bacManifestRow,
          label: 'bac',
        },
        {
          series_id: 'health_marker::blood_glucose',
          series_type: 'health_marker',
          label: 'blood_glucose',
          response_type: 'numeric',
          is_blood_pressure: false,
          unit: 'mg/dL',
          observation_count: 1,
          first_observed_at: '2026-01-01T00:00:00.000Z',
          last_observed_at: '2026-02-01T00:00:00.000Z',
        },
      ],
    });

    renderInsights();

    expect(
      await screen.findByTestId('manifest-label-health_marker::bac'),
    ).toHaveTextContent('BAC');
    expect(
      screen.getByTestId('manifest-label-health_marker::blood_glucose'),
    ).toHaveTextContent('Glucose');
  });

  it('clears series selection and skips chart fetch after PHI subject switch', async () => {
    const view = renderInsights();

    await screen.findByRole('button', { name: 'Select first series' });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Select first series' }),
      );
    });

    await waitFor(() => {
      expect(getChartSeriesMock).toHaveBeenCalled();
    });
    getChartSeriesMock.mockClear();

    phiContext.phiSubjectUserId = PHI_SUBJECT_B;
    phiContext.loading = false;
    getUserChartManifestMock.mockResolvedValue({ ok: true, data: [] });

    view.rerender(
      <LiveAnnouncerProvider>
        <InsightsClient />
      </LiveAnnouncerProvider>,
    );

    expect(
      await screen.findByText(
        'No data to chart yet. Log some episodes or health markers to get started.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('composed-chart')).not.toBeInTheDocument();
    expect(getChartSeriesMock).not.toHaveBeenCalled();
  });

  it('does not render the chart when the series RPC fails', async () => {
    getChartSeriesMock.mockResolvedValue({
      ok: false,
      error: { message: 'Chart RPC failed.', code: 'rpc_error' },
    });

    renderInsights();

    await screen.findByRole('button', { name: 'Select first series' });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Select first series' }),
      );
    });

    expect(await screen.findByText('Chart RPC failed.')).toBeInTheDocument();
    expect(screen.queryByTestId('composed-chart')).not.toBeInTheDocument();
  });

  it('refetches chart series when the date range changes', async () => {
    const updatedRange = {
      from: new Date(2026, 0, 1),
      to: new Date(2026, 0, 31),
    };
    const defaultBounds = insightDateRangeToRpcBounds(
      getDefaultInsightDateRange(),
    );
    const updatedBounds = insightDateRangeToRpcBounds(updatedRange);

    renderInsights();

    await screen.findByRole('button', { name: 'Select first series' });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Select first series' }),
      );
    });

    await waitFor(() => {
      expect(getChartSeriesMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          p_from: defaultBounds.p_from,
          p_to: defaultBounds.p_to,
        }),
      );
    });

    getChartSeriesMock.mockClear();

    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Set January 2026 range' }),
      );
    });

    await waitFor(() => {
      expect(getChartSeriesMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          p_from: updatedBounds.p_from,
          p_to: updatedBounds.p_to,
        }),
      );
    });
  });

  it('shows a banner when unseen practitioner chart snapshots exist', async () => {
    listUnseenChartSnapshotsForPatientMock.mockResolvedValue({
      ok: true,
      data: [SHARED_SNAPSHOT],
    });

    renderInsights();

    expect(
      await screen.findByText('Your practitioner shared a chart with you.'),
    ).toBeInTheDocument();
  });

  it('loads and marks a shared chart snapshot when the banner is activated', async () => {
    listUnseenChartSnapshotsForPatientMock.mockResolvedValue({
      ok: true,
      data: [SHARED_SNAPSHOT],
    });

    renderInsights();

    await screen.findByText('Your practitioner shared a chart with you.');
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: /your practitioner shared a chart with you/i,
        }),
      );
    });

    await waitFor(() => {
      expect(getChartSeriesMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          p_from: SHARED_SNAPSHOT.date_from,
          p_to: SHARED_SNAPSHOT.date_to,
          p_bucket: 'week',
        }),
      );
    });

    await waitFor(() => {
      expect(markChartSnapshotSeenMock).toHaveBeenCalledWith(
        expect.anything(),
        SHARED_SNAPSHOT_ID,
      );
    });

    expect(screen.getByText('Note from your practitioner')).toBeInTheDocument();
    expect(screen.getByText('Please review this trend.')).toBeInTheDocument();
  });

  it('clears the banner when mark returns false because the snapshot was already seen', async () => {
    listUnseenChartSnapshotsForPatientMock.mockResolvedValue({
      ok: true,
      data: [SHARED_SNAPSHOT],
    });
    markChartSnapshotSeenMock.mockResolvedValue({ ok: true, data: false });

    renderInsights();

    await screen.findByText('Your practitioner shared a chart with you.');
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: /your practitioner shared a chart with you/i,
        }),
      );
    });

    await waitFor(() => {
      expect(markChartSnapshotSeenMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(
        screen.queryByText('Your practitioner shared a chart with you.'),
      ).not.toBeInTheDocument();
    });
  });

  it('keeps the banner when mark_chart_snapshot_seen fails so the patient can retry', async () => {
    listUnseenChartSnapshotsForPatientMock.mockResolvedValue({
      ok: true,
      data: [SHARED_SNAPSHOT],
    });
    markChartSnapshotSeenMock.mockResolvedValue({
      ok: false,
      error: { message: 'Network error.', code: 'network_error' },
    });

    renderInsights();

    await screen.findByText('Your practitioner shared a chart with you.');
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: /your practitioner shared a chart with you/i,
        }),
      );
    });

    await waitFor(() => {
      expect(markChartSnapshotSeenMock).toHaveBeenCalled();
    });

    expect(
      screen.getByText('Your practitioner shared a chart with you.'),
    ).toBeInTheDocument();
  });

  it('does not query unseen snapshots when viewing another PHI subject', async () => {
    phiContext.phiSubjectUserId = PHI_SUBJECT_B;
    phiContext.authUserId = PHI_SUBJECT_A;

    renderInsights();

    await screen.findByTestId('date-range-picker');
    expect(listUnseenChartSnapshotsForPatientMock).not.toHaveBeenCalled();
    expect(
      screen.queryByText('Your practitioner shared a chart with you.'),
    ).not.toBeInTheDocument();
  });

  it('updates chart bucket when the bucket selector changes', async () => {
    renderInsights();

    await screen.findByRole('button', { name: 'Select first series' });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Select first series' }),
      );
    });

    await waitFor(() => {
      expect(getChartSeriesMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ p_bucket: 'day' }),
      );
    });

    getChartSeriesMock.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    });

    await waitFor(() => {
      expect(getChartSeriesMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ p_bucket: 'week' }),
      );
    });
  });
});
