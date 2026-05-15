import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  episodeTimelineBoundedSymptomMarkerText,
  type PractitionerPatientEpisodeRow,
  type PractitionerPatientObservationReadModel,
} from '@abstrack/supabase';
import { LiveAnnouncerProvider } from '@abstrack/ui/a11y-web';
import { PractitionerPatientDetailPage } from '../src/app/patients/[patientId]/practitioner-patient-detail-page';

const loadPractitionerPatientObservationReadModel = jest.fn();

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
  };
});

function episodeRow(): PractitionerPatientEpisodeRow {
  return {
    id: 'eeeeeeee-bbbb-cccc-dddd-aaaaaaaaaaaa',
    user_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    additional_notes: null,
    created_at: '2026-04-01T10:00:00.000Z',
    ended_at: null,
    episode_label: null,
    episode_type: 'ABS',
    health_marker_preset_id: null,
    note: null,
    post_marker_step_completed_at: null,
    started_at: '2026-04-01T10:00:00.000Z',
    symptom_preset_id: null,
    updated_at: '2026-04-01T10:00:00.000Z',
  };
}

describe('PractitionerPatientDetailPage', () => {
  beforeEach(() => {
    loadPractitionerPatientObservationReadModel.mockReset();
  });

  it('shows an alert when the read model returns permission_denied', async () => {
    loadPractitionerPatientObservationReadModel.mockResolvedValue({
      ok: false,
      error: {
        code: 'permission_denied',
        message:
          'You do not have access to this patient, or the link is no longer active.',
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

  it('does not apply stale read models when patientUserId changes before an earlier request settles', async () => {
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

    fireEvent.click(screen.getByText('Show episode timeline'));

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

    fireEvent.click(screen.getByText('Show standalone entries'));

    expect(await screen.findByText('StandaloneRow-40')).toBeTruthy();
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
