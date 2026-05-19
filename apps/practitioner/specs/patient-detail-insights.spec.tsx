import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { LiveAnnouncerProvider } from '@abstrack/ui/a11y-web';
import type {
  ChartManifestRow,
  InsightDateRange,
  SelectedSeries,
} from '@abstrack/ui';
import {
  getChartSeries,
  getUserChartManifest,
  shareChartSnapshot,
} from '@abstrack/supabase';
import { PractitionerPatientDetailPage } from '../src/app/patients/[patientId]/practitioner-patient-detail-page';
import {
  getDefaultInsightDateRange,
  insightDateRangeToRpcBounds,
} from '../src/lib/insights/insight-chart-params';

const PATIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PRACTITIONER_USER_ID = '11111111-1111-1111-1111-111111111111';
const SNAPSHOT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

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

const loadPractitionerPatientObservationReadModel = jest.fn();
const listPractitionerObservationNotesForPatient = jest.fn();

jest.mock('../src/lib/auth-provider', () => ({
  useAuth: () => ({
    session: { user: { id: PRACTITIONER_USER_ID } },
    loading: false,
    profile: undefined,
    profileError: null,
    accessTokenClaims: null,
    gate: { kind: 'practitioner' as const },
  }),
}));

jest.mock('@abstrack/supabase/browser', () => ({
  getSupabaseBrowserClient: jest.fn(() => ({})),
}));

jest.mock('@abstrack/supabase', () => {
  const actual =
    jest.requireActual<typeof import('@abstrack/supabase')>(
      '@abstrack/supabase',
    );
  return {
    ...actual,
    loadPractitionerPatientObservationReadModel: (...args: unknown[]) =>
      loadPractitionerPatientObservationReadModel(...args),
    listPractitionerObservationNotesForPatient: (...args: unknown[]) =>
      listPractitionerObservationNotesForPatient(...args),
    getUserChartManifest: jest.fn(),
    getChartSeries: jest.fn(),
    shareChartSnapshot: jest.fn(),
  };
});

jest.mock('@abstrack/ui', () => {
  const uiLib = '../../../packages/ui/src/lib';
  const { pivotChartSeriesBucketRows } = jest.requireActual(
    `${uiLib}/insight-composed-chart-utils`,
  );
  const { filterChartableManifestRows, reconcileSelectedSeriesWithManifest } =
    jest.requireActual(`${uiLib}/insight-series-picker-utils`);
  return {
    pivotChartSeriesBucketRows,
    filterChartableManifestRows,
    reconcileSelectedSeriesWithManifest,
    InsightSeriesPicker: ({
      manifest,
      value,
      onChange,
    }: {
      manifest: ChartManifestRow[];
      value: SelectedSeries[];
      onChange: (next: SelectedSeries[]) => void;
    }) => (
      <div>
        <button
          type="button"
          onClick={() => {
            const row = manifest[0];
            if (!row) {
              return;
            }
            onChange([
              {
                seriesId: row.series_id,
                seriesType: row.series_type,
                responseType: row.response_type as 'numeric',
                isBloodPressure: row.is_blood_pressure,
                label: row.label,
                unit: row.unit,
                chartType: 'line',
                color: '#1d4ed8',
              },
            ]);
          }}
        >
          Select first series
        </button>
        <span data-testid="selected-count">{value.length}</span>
      </div>
    ),
    InsightDateRangePicker: ({
      value,
      onChange,
    }: {
      value: InsightDateRange;
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
        <span data-testid="range-from">{value.from.toISOString()}</span>
      </div>
    ),
    InsightComposedChart: () => <div data-testid="composed-chart" />,
  };
});

const getUserChartManifestMock = getUserChartManifest as jest.MockedFunction<
  typeof getUserChartManifest
>;
const getChartSeriesMock = getChartSeries as jest.MockedFunction<
  typeof getChartSeries
>;
const shareChartSnapshotMock = shareChartSnapshot as jest.MockedFunction<
  typeof shareChartSnapshot
>;

function ensureDialogElementPolyfill(): void {
  HTMLDialogElement.prototype.showModal =
    HTMLDialogElement.prototype.showModal ||
    function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  HTMLDialogElement.prototype.close =
    HTMLDialogElement.prototype.close ||
    function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    };
}

function emptyObservationModel(patientUserId: string) {
  return {
    ok: true as const,
    data: {
      patientUserId,
      patientDisplayName: 'Alex Kim',
      moreEpisodesOmitted: false,
      standaloneHealthMarkersTruncated: false,
      standaloneFoodDiaryTruncated: false,
      standaloneTimeline: [],
      episodesWithTimelines: [],
    },
  };
}

function renderPatientDetail() {
  return render(
    <LiveAnnouncerProvider>
      <PractitionerPatientDetailPage patientUserId={PATIENT_ID} />
    </LiveAnnouncerProvider>,
  );
}

async function openInsightsTab(): Promise<void> {
  fireEvent.click(screen.getByRole('tab', { name: /^insights$/i }));
  await waitFor(() =>
    expect(screen.getByRole('tab', { name: /^insights$/i })).toHaveAttribute(
      'aria-selected',
      'true',
    ),
  );
}

async function selectSeriesAndWaitForChart(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /select first series/i }));
  await waitFor(() =>
    expect(getChartSeriesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ p_user_id: PATIENT_ID }),
    ),
  );
}

describe('PractitionerPatientDetailPage insights tab', () => {
  beforeEach(() => {
    ensureDialogElementPolyfill();
    jest.clearAllMocks();
    loadPractitionerPatientObservationReadModel.mockResolvedValue(
      emptyObservationModel(PATIENT_ID),
    );
    listPractitionerObservationNotesForPatient.mockResolvedValue({
      ok: true,
      data: [],
    });
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
    shareChartSnapshotMock.mockResolvedValue({ ok: true, data: SNAPSHOT_ID });
  });

  it('passes patient user id (not practitioner id) to chart RPC wrappers', async () => {
    renderPatientDetail();
    await screen.findByText('Alex Kim');
    await openInsightsTab();

    await waitFor(() =>
      expect(getUserChartManifestMock).toHaveBeenCalledWith(
        expect.anything(),
        PATIENT_ID,
      ),
    );
    expect(getUserChartManifestMock).not.toHaveBeenCalledWith(
      expect.anything(),
      PRACTITIONER_USER_ID,
    );

    await selectSeriesAndWaitForChart();

    expect(getChartSeriesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ p_user_id: PATIENT_ID }),
    );
    expect(getChartSeriesMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ p_user_id: PRACTITIONER_USER_ID }),
    );
  });

  it('opens ConfirmDialog when Share with patient is clicked', async () => {
    renderPatientDetail();
    await screen.findByText('Alex Kim');
    await openInsightsTab();
    await selectSeriesAndWaitForChart();

    fireEvent.click(
      screen.getByRole('button', { name: /share with patient/i }),
    );

    expect(
      await screen.findByRole('heading', { name: /share chart with patient/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/note for patient/i, { selector: 'textarea' }),
    ).toBeInTheDocument();
  });

  it('calls shareChartSnapshot with chart payload on confirm', async () => {
    renderPatientDetail();
    await screen.findByText('Alex Kim');
    await openInsightsTab();
    await selectSeriesAndWaitForChart();

    fireEvent.click(
      screen.getByRole('button', { name: /share with patient/i }),
    );

    const noteField = screen.getByLabelText(/note for patient/i, {
      selector: 'textarea',
    });
    fireEvent.change(noteField, {
      target: { value: 'Please review this trend.' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^share chart$/i }));
    });

    await waitFor(() => expect(shareChartSnapshotMock).toHaveBeenCalled());

    const call = shareChartSnapshotMock.mock.calls[0];
    const { p_from, p_to } = insightDateRangeToRpcBounds(
      getDefaultInsightDateRange(),
    );
    expect(call?.[1]).toEqual(
      expect.objectContaining({
        patientUserId: PATIENT_ID,
        bucket: 'day',
        practitionerNote: 'Please review this trend.',
        dateFrom: p_from,
        dateTo: p_to,
        seriesDefinition: [
          expect.objectContaining({
            seriesId: bacManifestRow.series_id,
            seriesType: 'health_marker',
            chartType: 'line',
          }),
        ],
      }),
    );
    expect(call?.[1]?.dateFrom).toBe(p_from);
    expect(call?.[1]?.dateTo).toBe(p_to);
  });
});
