import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  episodeTimelineBoundedSymptomMarkerText,
  formatPractitionerPatientDirectoryLabel,
  PRACTITIONER_PATIENT_OBSERVATION_GRANT_DENIED_MESSAGE,
  type PractitionerPatientEpisodeRow,
  type PractitionerPatientObservationReadModel,
} from '@abstrack/supabase';
import { LiveAnnouncerProvider } from '@abstrack/ui/a11y-web';
import { PractitionerPatientDetailPage } from '../src/app/patients/[patientId]/practitioner-patient-detail-page';

/**
 * Fire a click on the `<summary>` that contains the control label so `<details>` toggles reliably in jsdom.
 *
 * @param label - Text shown inside the disclosure summary.
 * @param index - Which occurrence when multiple disclosures reuse the same label.
 */
function clickDetailsToggle(label: string, index = 0): void {
  const node = screen.getAllByText(label)[index];
  if (!node) {
    throw new Error(
      `Missing disclosure label "${label}" at index ${String(index)}`,
    );
  }
  const summary = node.closest('summary');
  if (!summary) {
    throw new Error(`Expected <summary> wrapping "${label}"`);
  }
  fireEvent.click(summary);
}

const loadPractitionerPatientObservationReadModel = jest.fn();
const listEpisodeMediaForEpisode = jest.fn();
const createEpisodeMediaSignedDisplayUrl = jest.fn();

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
    listEpisodeMediaForEpisode: (...args: unknown[]) =>
      listEpisodeMediaForEpisode(...args),
    createEpisodeMediaSignedDisplayUrl: (...args: unknown[]) =>
      createEpisodeMediaSignedDisplayUrl(...args),
  };
});

function episodeRow(): PractitionerPatientEpisodeRow {
  return {
    id: 'eeeeeeee-bbbb-cccc-dddd-aaaaaaaaaaaa',
    ended_at: null,
    episode_label: null,
    episode_type: 'ABS',
    started_at: '2026-04-01T10:00:00.000Z',
  };
}

describe('PractitionerPatientDetailPage', () => {
  beforeEach(() => {
    loadPractitionerPatientObservationReadModel.mockReset();
    listEpisodeMediaForEpisode.mockReset();
    createEpisodeMediaSignedDisplayUrl.mockReset();
  });

  it('shows an alert when the read model returns permission_denied', async () => {
    loadPractitionerPatientObservationReadModel.mockResolvedValue({
      ok: false,
      error: {
        code: 'permission_denied',
        message: PRACTITIONER_PATIENT_OBSERVATION_GRANT_DENIED_MESSAGE,
        name: 'PresetDataError',
      },
    });

    render(
      <LiveAnnouncerProvider>
        <PractitionerPatientDetailPage patientUserId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" />
      </LiveAnnouncerProvider>,
    );

    const tryAgain = await screen.findByRole('button', { name: /try again/i });
    const inlineAlert = tryAgain.closest('[role="alert"]');
    expect(inlineAlert).toBeTruthy();
    expect(
      inlineAlert?.textContent?.toLowerCase().includes('do not have access'),
    ).toBe(true);
  });

  it('shows MFA recovery copy when permission_denied is the generic preset-data message', async () => {
    loadPractitionerPatientObservationReadModel.mockResolvedValue({
      ok: false,
      error: {
        code: 'permission_denied',
        message: 'You do not have permission to do that.',
        name: 'PresetDataError',
      },
    });

    render(
      <LiveAnnouncerProvider>
        <PractitionerPatientDetailPage patientUserId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" />
      </LiveAnnouncerProvider>,
    );

    const tryAgain = await screen.findByRole('button', { name: /try again/i });
    const inlineAlert = tryAgain.closest('[role="alert"]');
    expect(inlineAlert).toBeTruthy();
    expect(inlineAlert?.textContent).toContain('two-factor');
  });

  it('loads successfully when the route id has surrounding whitespace', async () => {
    const canonicalId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const paddedRouteId = `  ${canonicalId}  `;

    loadPractitionerPatientObservationReadModel.mockResolvedValue({
      ok: true,
      data: {
        patientUserId: canonicalId,
        patientDisplayName: 'Alex Kim',
        moreEpisodesOmitted: false,
        standaloneHealthMarkersTruncated: false,
        standaloneFoodDiaryTruncated: false,
        standaloneTimeline: [],
        episodesWithTimelines: [],
      },
    });

    render(
      <LiveAnnouncerProvider>
        <PractitionerPatientDetailPage patientUserId={paddedRouteId} />
      </LiveAnnouncerProvider>,
    );

    expect(await screen.findByText('Alex Kim')).toBeTruthy();
    expect(loadPractitionerPatientObservationReadModel).toHaveBeenCalledWith(
      expect.anything(),
      canonicalId,
    );
    expect(screen.queryByText(/loading patient record/i)).toBeNull();
  });

  it('when the first patient request is still pending, navigation supersedes it so a late response cannot replace the new route', async () => {
    const patientA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const patientB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    let resolveSlow!: (value: {
      ok: true;
      data: PractitionerPatientObservationReadModel;
    }) => void;
    const slowPromise = new Promise<{
      ok: true;
      data: PractitionerPatientObservationReadModel;
    }>((resolve) => {
      resolveSlow = resolve;
    });

    loadPractitionerPatientObservationReadModel.mockImplementation(
      async (_client, uid) => {
        if (uid === patientA) {
          return slowPromise;
        }
        if (uid === patientB) {
          return {
            ok: true,
            data: {
              patientUserId: patientB,
              patientDisplayName: 'Bob Jones',
              moreEpisodesOmitted: false,
              standaloneHealthMarkersTruncated: false,
              standaloneFoodDiaryTruncated: false,
              standaloneTimeline: [],
              episodesWithTimelines: [],
            },
          };
        }
        throw new Error(`unexpected patient ${String(uid)}`);
      },
    );

    const { rerender } = render(
      <LiveAnnouncerProvider>
        <PractitionerPatientDetailPage patientUserId={patientA} />
      </LiveAnnouncerProvider>,
    );

    await waitFor(() =>
      expect(loadPractitionerPatientObservationReadModel).toHaveBeenCalledWith(
        expect.anything(),
        patientA,
      ),
    );

    rerender(
      <LiveAnnouncerProvider>
        <PractitionerPatientDetailPage patientUserId={patientB} />
      </LiveAnnouncerProvider>,
    );

    expect(await screen.findByText('Bob Jones')).toBeTruthy();

    resolveSlow({
      ok: true,
      data: {
        patientUserId: patientA,
        patientDisplayName: 'Stale Wrong Name',
        moreEpisodesOmitted: false,
        standaloneHealthMarkersTruncated: false,
        standaloneFoodDiaryTruncated: false,
        standaloneTimeline: [],
        episodesWithTimelines: [],
      },
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(
        'Bob Jones',
      );
    });
    expect(screen.queryByText('Stale Wrong Name')).toBeNull();
  });

  /**
   * Regression: after patient A has **already** reached `ready` (not only while A's first fetch is
   * in-flight), `loadState` can still hold A until the next effect runs `load`. UI must gate on
   * `patientUserId` so B's route never shows A's timeline or display name while B is loading.
   */
  it('after patient A read model is ready, navigation to patient B hides A PHI until B load completes', async () => {
    const patientA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const patientB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    let resolveB!: (value: {
      ok: true;
      data: PractitionerPatientObservationReadModel;
    }) => void;
    const slowB = new Promise<{
      ok: true;
      data: PractitionerPatientObservationReadModel;
    }>((resolve) => {
      resolveB = resolve;
    });

    loadPractitionerPatientObservationReadModel.mockImplementation(
      async (_client, uid) => {
        if (uid === patientA) {
          return {
            ok: true,
            data: {
              patientUserId: patientA,
              patientDisplayName: 'Alice Alpha',
              moreEpisodesOmitted: false,
              standaloneHealthMarkersTruncated: false,
              standaloneFoodDiaryTruncated: false,
              standaloneTimeline: [],
              episodesWithTimelines: [
                {
                  episode: episodeRow(),
                  moreSymptomsOmitted: false,
                  moreHealthMarkersOmitted: false,
                  moreFoodDiaryOmitted: false,
                  timeline: [
                    {
                      kind: 'symptom',
                      sortAt: '2026-04-01T12:00:00.000Z',
                      id: 'sym-alice-only',
                      label: 'OnlyOnPatientAliceTimeline',
                      detail: 'Yes',
                    },
                  ],
                },
              ],
            },
          };
        }
        if (uid === patientB) {
          return slowB;
        }
        throw new Error(`unexpected patient ${String(uid)}`);
      },
    );

    const { rerender } = render(
      <LiveAnnouncerProvider>
        <PractitionerPatientDetailPage patientUserId={patientA} />
      </LiveAnnouncerProvider>,
    );

    expect(await screen.findByText('Alice Alpha')).toBeTruthy();
    clickDetailsToggle('Show episode timeline');
    expect(screen.getByText('OnlyOnPatientAliceTimeline')).toBeTruthy();

    rerender(
      <LiveAnnouncerProvider>
        <PractitionerPatientDetailPage patientUserId={patientB} />
      </LiveAnnouncerProvider>,
    );

    expect(screen.queryByText('Alice Alpha')).toBeNull();
    expect(screen.queryByText('OnlyOnPatientAliceTimeline')).toBeNull();
    expect(screen.getByText('Loading patient record…')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      formatPractitionerPatientDirectoryLabel(patientB, null),
    );

    resolveB({
      ok: true,
      data: {
        patientUserId: patientB,
        patientDisplayName: 'Bob Jones',
        moreEpisodesOmitted: false,
        standaloneHealthMarkersTruncated: false,
        standaloneFoodDiaryTruncated: false,
        standaloneTimeline: [],
        episodesWithTimelines: [],
      },
    });

    expect(await screen.findByText('Bob Jones')).toBeTruthy();
  });

  it('when the first patient error is still pending, navigation supersedes it so a late failure cannot surface on the new route', async () => {
    const patientA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const patientB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    let resolveSlow!: (value: {
      ok: false;
      error: { message: string; code: string; name: string };
    }) => void;
    const slowPromise = new Promise<{
      ok: false;
      error: { message: string; code: string; name: string };
    }>((resolve) => {
      resolveSlow = resolve;
    });

    loadPractitionerPatientObservationReadModel.mockImplementation(
      async (_client, uid) => {
        if (uid === patientA) {
          return slowPromise;
        }
        if (uid === patientB) {
          return {
            ok: true,
            data: {
              patientUserId: patientB,
              patientDisplayName: 'Bob Jones',
              moreEpisodesOmitted: false,
              standaloneHealthMarkersTruncated: false,
              standaloneFoodDiaryTruncated: false,
              standaloneTimeline: [],
              episodesWithTimelines: [],
            },
          };
        }
        throw new Error(`unexpected patient ${String(uid)}`);
      },
    );

    const { rerender } = render(
      <LiveAnnouncerProvider>
        <PractitionerPatientDetailPage patientUserId={patientA} />
      </LiveAnnouncerProvider>,
    );

    await waitFor(() =>
      expect(loadPractitionerPatientObservationReadModel).toHaveBeenCalledWith(
        expect.anything(),
        patientA,
      ),
    );

    rerender(
      <LiveAnnouncerProvider>
        <PractitionerPatientDetailPage patientUserId={patientB} />
      </LiveAnnouncerProvider>,
    );

    expect(await screen.findByText('Bob Jones')).toBeTruthy();

    resolveSlow({
      ok: false,
      error: {
        code: 'unknown',
        message: 'Stale error for patient A',
        name: 'PresetDataError',
      },
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 }).textContent).toContain(
        'Bob Jones',
      );
    });
    expect(screen.queryByText('Stale error for patient A')).toBeNull();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('renders a symptom row from a successful timeline load', async () => {
    loadPractitionerPatientObservationReadModel.mockResolvedValue({
      ok: true,
      data: {
        patientUserId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        patientDisplayName: 'Alex Kim',
        moreEpisodesOmitted: false,
        standaloneHealthMarkersTruncated: false,
        standaloneFoodDiaryTruncated: false,
        standaloneTimeline: [],
        episodesWithTimelines: [
          {
            episode: episodeRow(),
            moreSymptomsOmitted: false,
            moreHealthMarkersOmitted: false,
            moreFoodDiaryOmitted: false,
            timeline: [
              {
                kind: 'symptom',
                sortAt: '2026-04-01T12:05:00.000Z',
                id: 'sym-1',
                label: 'Nausea',
                detail: 'Yes',
              },
            ],
          },
        ],
      },
    });

    render(
      <LiveAnnouncerProvider>
        <PractitionerPatientDetailPage patientUserId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" />
      </LiveAnnouncerProvider>,
    );

    expect(await screen.findByText('Alex Kim')).toBeTruthy();
    clickDetailsToggle('Show episode timeline');
    expect(screen.getByText('Nausea')).toBeTruthy();
    expect(screen.getByText('Yes')).toBeTruthy();
  });

  it('lazy-mounts non-primary episode timelines until the section expands', async () => {
    const ep1 = episodeRow();
    const ep2: PractitionerPatientEpisodeRow = {
      ...episodeRow(),
      id: 'ffffffff-bbbb-cccc-dddd-aaaaaaaaaaaa',
      started_at: '2026-03-01T10:00:00.000Z',
    };

    loadPractitionerPatientObservationReadModel.mockResolvedValue({
      ok: true,
      data: {
        patientUserId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        patientDisplayName: 'Alex Kim',
        moreEpisodesOmitted: false,
        standaloneHealthMarkersTruncated: false,
        standaloneFoodDiaryTruncated: false,
        standaloneTimeline: [],
        episodesWithTimelines: [
          {
            episode: ep1,
            moreSymptomsOmitted: false,
            moreHealthMarkersOmitted: false,
            moreFoodDiaryOmitted: false,
            timeline: [],
          },
          {
            episode: ep2,
            moreSymptomsOmitted: false,
            moreHealthMarkersOmitted: false,
            moreFoodDiaryOmitted: false,
            timeline: [
              {
                kind: 'symptom',
                sortAt: '2026-04-01T12:05:00.000Z',
                id: 'sym-hidden',
                label: 'LaterEpisodeSymptom',
                detail: 'Yes',
              },
            ],
          },
        ],
      },
    });

    render(
      <LiveAnnouncerProvider>
        <PractitionerPatientDetailPage patientUserId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" />
      </LiveAnnouncerProvider>,
    );

    await screen.findByText('Alex Kim');
    expect(screen.queryByText('LaterEpisodeSymptom')).toBeNull();

    clickDetailsToggle('Show episode timeline', 1);

    expect(await screen.findByText('LaterEpisodeSymptom')).toBeTruthy();
    expect(screen.getByText('Yes')).toBeTruthy();
  });

  it('lazy-mounts large standalone timelines until the section expands', async () => {
    const standaloneTimeline = Array.from({ length: 41 }, (_, i) => ({
      kind: 'symptom' as const,
      sortAt: `2026-04-01T12:${String(i).padStart(2, '0')}:00.000Z`,
      id: `stand-${i}`,
      label: `StandaloneRow-${i}`,
      detail: 'Note',
    }));

    loadPractitionerPatientObservationReadModel.mockResolvedValue({
      ok: true,
      data: {
        patientUserId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        patientDisplayName: 'Alex Kim',
        moreEpisodesOmitted: false,
        standaloneHealthMarkersTruncated: false,
        standaloneFoodDiaryTruncated: false,
        standaloneTimeline,
        episodesWithTimelines: [],
      },
    });

    render(
      <LiveAnnouncerProvider>
        <PractitionerPatientDetailPage patientUserId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" />
      </LiveAnnouncerProvider>,
    );

    await screen.findByText('Alex Kim');
    expect(screen.queryByText('StandaloneRow-40')).toBeNull();

    clickDetailsToggle('Show standalone entries');

    expect(await screen.findByText('StandaloneRow-40')).toBeTruthy();
  });

  it('resets standalone lazy-mount when patientUserId changes from a small list to a large one', async () => {
    const patientA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const patientB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    const smallTimeline = Array.from({ length: 5 }, (_, i) => ({
      kind: 'symptom' as const,
      sortAt: `2026-04-01T12:${String(i).padStart(2, '0')}:00.000Z`,
      id: `a-stand-${i}`,
      label: `PatientA-${i}`,
      detail: 'Note',
    }));

    const largeTimeline = Array.from({ length: 41 }, (_, i) => ({
      kind: 'symptom' as const,
      sortAt: `2026-04-01T13:${String(i).padStart(2, '0')}:00.000Z`,
      id: `b-stand-${i}`,
      label: `PatientB-${i}`,
      detail: 'Note',
    }));

    loadPractitionerPatientObservationReadModel.mockImplementation(
      async (_client, uid: string) => {
        if (uid === patientA) {
          return {
            ok: true,
            data: {
              patientUserId: patientA,
              patientDisplayName: 'Alex',
              moreEpisodesOmitted: false,
              standaloneHealthMarkersTruncated: false,
              standaloneFoodDiaryTruncated: false,
              standaloneTimeline: smallTimeline,
              episodesWithTimelines: [],
            },
          };
        }
        if (uid === patientB) {
          return {
            ok: true,
            data: {
              patientUserId: patientB,
              patientDisplayName: 'Bob',
              moreEpisodesOmitted: false,
              standaloneHealthMarkersTruncated: false,
              standaloneFoodDiaryTruncated: false,
              standaloneTimeline: largeTimeline,
              episodesWithTimelines: [],
            },
          };
        }
        throw new Error(`unexpected patient ${uid}`);
      },
    );

    const { rerender } = render(
      <LiveAnnouncerProvider>
        <PractitionerPatientDetailPage patientUserId={patientA} />
      </LiveAnnouncerProvider>,
    );

    await screen.findByText('Alex');
    expect(screen.queryByText('PatientA-4')).toBeNull();
    clickDetailsToggle('Show standalone entries');
    expect(screen.getByText('PatientA-4')).toBeTruthy();

    rerender(
      <LiveAnnouncerProvider>
        <PractitionerPatientDetailPage patientUserId={patientB} />
      </LiveAnnouncerProvider>,
    );

    await screen.findByText('Bob');
    expect(screen.queryByText('PatientB-40')).toBeNull();

    clickDetailsToggle('Show standalone entries');
    expect(await screen.findByText('PatientB-40')).toBeTruthy();
  });

  it('resets standalone lazy-mount when patientUserId changes from a large list to a small one', async () => {
    const patientA = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const patientB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    const largeTimeline = Array.from({ length: 41 }, (_, i) => ({
      kind: 'symptom' as const,
      sortAt: `2026-04-01T12:${String(i).padStart(2, '0')}:00.000Z`,
      id: `a-stand-${i}`,
      label: `PatientA-${i}`,
      detail: 'Note',
    }));

    const smallTimeline = Array.from({ length: 5 }, (_, i) => ({
      kind: 'symptom' as const,
      sortAt: `2026-04-01T13:${String(i).padStart(2, '0')}:00.000Z`,
      id: `b-stand-${i}`,
      label: `PatientB-${i}`,
      detail: 'Note',
    }));

    loadPractitionerPatientObservationReadModel.mockImplementation(
      async (_client, uid: string) => {
        if (uid === patientA) {
          return {
            ok: true,
            data: {
              patientUserId: patientA,
              patientDisplayName: 'Alex',
              moreEpisodesOmitted: false,
              standaloneHealthMarkersTruncated: false,
              standaloneFoodDiaryTruncated: false,
              standaloneTimeline: largeTimeline,
              episodesWithTimelines: [],
            },
          };
        }
        if (uid === patientB) {
          return {
            ok: true,
            data: {
              patientUserId: patientB,
              patientDisplayName: 'Bob',
              moreEpisodesOmitted: false,
              standaloneHealthMarkersTruncated: false,
              standaloneFoodDiaryTruncated: false,
              standaloneTimeline: smallTimeline,
              episodesWithTimelines: [],
            },
          };
        }
        throw new Error(`unexpected patient ${uid}`);
      },
    );

    const { rerender } = render(
      <LiveAnnouncerProvider>
        <PractitionerPatientDetailPage patientUserId={patientA} />
      </LiveAnnouncerProvider>,
    );

    await screen.findByText('Alex');
    expect(screen.queryByText('PatientA-40')).toBeNull();
    clickDetailsToggle('Show standalone entries');
    expect(await screen.findByText('PatientA-40')).toBeTruthy();

    rerender(
      <LiveAnnouncerProvider>
        <PractitionerPatientDetailPage patientUserId={patientB} />
      </LiveAnnouncerProvider>,
    );

    await screen.findByText('Bob');
    expect(screen.queryByText('PatientB-4')).toBeNull();
    clickDetailsToggle('Show standalone entries');
    expect(screen.getByText('PatientB-4')).toBeTruthy();
  });

  it('loads photo symptom media via signed URL and supports refresh after display error', async () => {
    const episodeId = 'eeeeeeee-bbbb-cccc-dddd-aaaaaaaaaaaa';
    const symptomId = 'sym-photo-1';

    loadPractitionerPatientObservationReadModel.mockResolvedValue({
      ok: true,
      data: {
        patientUserId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        patientDisplayName: 'Alex Kim',
        moreEpisodesOmitted: false,
        standaloneHealthMarkersTruncated: false,
        standaloneFoodDiaryTruncated: false,
        standaloneTimeline: [],
        episodesWithTimelines: [
          {
            episode: episodeRow(),
            moreSymptomsOmitted: false,
            moreHealthMarkersOmitted: false,
            moreFoodDiaryOmitted: false,
            timeline: [
              {
                kind: 'symptom',
                sortAt: '2026-04-01T12:05:00.000Z',
                id: symptomId,
                label: 'Rash photo',
                detail: 'Photo',
              },
            ],
          },
        ],
      },
    });

    listEpisodeMediaForEpisode.mockResolvedValue({
      ok: true,
      data: [
        {
          episode_symptom_id: symptomId,
          storage_object_key: 'user/ep/photo-1.jpg',
          thumbnail_storage_key: null,
          media_type: 'photo',
          upload_completed_at: '2026-04-01T12:05:01.000Z',
          duration_seconds: null,
        },
      ],
    });

    createEpisodeMediaSignedDisplayUrl
      .mockResolvedValueOnce({
        signedUrl: 'https://example.test/signed-photo',
        errorMessage: null,
      })
      .mockResolvedValueOnce({
        signedUrl: 'https://example.test/signed-photo-refreshed',
        errorMessage: null,
      });

    render(
      <LiveAnnouncerProvider>
        <PractitionerPatientDetailPage patientUserId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" />
      </LiveAnnouncerProvider>,
    );

    await screen.findByText('Alex Kim');
    clickDetailsToggle('Show episode timeline');

    const viewPhoto = await screen.findByRole('button', {
      name: /view photo/i,
    });
    fireEvent.click(viewPhoto);

    await waitFor(() => {
      expect(listEpisodeMediaForEpisode).toHaveBeenCalledWith(
        expect.anything(),
        episodeId,
        { episodeSymptomIds: [symptomId] },
      );
    });

    const previewButton = await screen.findByRole('button', {
      name: /view full size photo for rash photo/i,
    });
    const previewImg = previewButton.querySelector('img');
    expect(previewImg).toBeTruthy();
    expect(previewImg!.getAttribute('src')).toBe(
      'https://example.test/signed-photo',
    );

    fireEvent.error(previewImg!);

    const viewer = screen.getByTestId('practitioner-symptom-media-viewer');
    expect(within(viewer).getByRole('alert').textContent).toMatch(
      /link expired or unavailable/i,
    );

    fireEvent.click(
      within(viewer).getByRole('button', { name: /refresh media link/i }),
    );

    await waitFor(() => {
      expect(createEpisodeMediaSignedDisplayUrl).toHaveBeenCalledTimes(2);
    });
    const refreshedPreview = screen
      .getByRole('button', { name: /view full size photo for rash photo/i })
      .querySelector('img');
    expect(refreshedPreview?.getAttribute('src')).toBe(
      'https://example.test/signed-photo-refreshed',
    );
  });

  it('reopens the full-size photo modal after Close without reloading media', async () => {
    loadPractitionerPatientObservationReadModel.mockResolvedValue({
      ok: true,
      data: {
        patientUserId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        patientDisplayName: 'Alex Kim',
        moreEpisodesOmitted: false,
        standaloneHealthMarkersTruncated: false,
        standaloneFoodDiaryTruncated: false,
        standaloneTimeline: [],
        episodesWithTimelines: [
          {
            episode: episodeRow(),
            moreSymptomsOmitted: false,
            moreHealthMarkersOmitted: false,
            moreFoodDiaryOmitted: false,
            timeline: [
              {
                kind: 'symptom',
                sortAt: '2026-04-01T12:05:00.000Z',
                id: 'sym-photo-reopen',
                label: 'Rash photo',
                detail: 'Photo',
              },
            ],
          },
        ],
      },
    });

    listEpisodeMediaForEpisode.mockResolvedValue({
      ok: true,
      data: [
        {
          episode_symptom_id: 'sym-photo-reopen',
          storage_object_key: 'user/ep/photo-reopen.jpg',
          thumbnail_storage_key: null,
          media_type: 'photo',
          upload_completed_at: '2026-04-01T12:05:01.000Z',
          duration_seconds: null,
        },
      ],
    });

    createEpisodeMediaSignedDisplayUrl.mockResolvedValue({
      signedUrl: 'https://example.test/signed-photo',
      errorMessage: null,
    });

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

    render(
      <LiveAnnouncerProvider>
        <PractitionerPatientDetailPage patientUserId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" />
      </LiveAnnouncerProvider>,
    );

    await screen.findByText('Alex Kim');
    clickDetailsToggle('Show episode timeline');
    fireEvent.click(await screen.findByRole('button', { name: /view photo/i }));

    const openFullSize = await screen.findByRole('button', {
      name: /view full size photo for rash photo/i,
    });

    fireEvent.click(openFullSize);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: /^close$/i }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    fireEvent.click(openFullSize);
    const dialogAgain = await screen.findByRole('dialog');
    fireEvent.click(
      screen.getByRole('button', { name: /close photo viewer/i }),
    );
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    fireEvent.click(openFullSize);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(createEpisodeMediaSignedDisplayUrl).toHaveBeenCalledTimes(1);
  });

  it('uses expandable disclosure when timeline rows carry detailFull', async () => {
    const longDetail = `${'q'.repeat(161)}TAIL`;
    const bounded = episodeTimelineBoundedSymptomMarkerText(longDetail);

    loadPractitionerPatientObservationReadModel.mockResolvedValue({
      ok: true,
      data: {
        patientUserId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        patientDisplayName: 'Alex Kim',
        moreEpisodesOmitted: false,
        standaloneHealthMarkersTruncated: false,
        standaloneFoodDiaryTruncated: false,
        standaloneTimeline: [],
        episodesWithTimelines: [
          {
            episode: episodeRow(),
            moreSymptomsOmitted: false,
            moreHealthMarkersOmitted: false,
            moreFoodDiaryOmitted: false,
            timeline: [
              {
                kind: 'symptom',
                sortAt: '2026-04-01T12:05:00.000Z',
                id: 'sym-long',
                label: 'Notes',
                detail: bounded.detail,
                ...(bounded.detailFull
                  ? { detailFull: bounded.detailFull }
                  : {}),
              },
            ],
          },
        ],
      },
    });

    render(
      <LiveAnnouncerProvider>
        <PractitionerPatientDetailPage patientUserId="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" />
      </LiveAnnouncerProvider>,
    );

    await screen.findByText('Alex Kim');
    clickDetailsToggle('Show episode timeline');
    expect(
      (await screen.findAllByText(longDetail, { hidden: true })).length,
    ).toBeGreaterThanOrEqual(1);
    const notesHeading = screen.getByText('Notes');
    const row = notesHeading.closest('li');
    expect(row).toBeTruthy();
    const detailsEl = row!.querySelector('details');
    expect(detailsEl).toBeTruthy();
    expect(detailsEl!.hasAttribute('open')).toBe(false);

    expect(within(row as HTMLElement).getByText('Show full note')).toBeTruthy();

    const summaryEl = detailsEl!.querySelector('summary');
    expect(summaryEl).toBeTruthy();
    fireEvent.click(summaryEl!);

    expect(detailsEl!.hasAttribute('open')).toBe(true);
    expect(
      within(row as HTMLElement).getByText('Collapse full note'),
    ).toBeTruthy();
  });
});
