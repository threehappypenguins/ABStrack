import { render, screen } from '@testing-library/react';
import type { PractitionerPatientEpisodeRow } from '@abstrack/supabase';
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

  it('renders a symptom row from a successful timeline load', async () => {
    loadPractitionerPatientObservationReadModel.mockResolvedValue({
      ok: true,
      data: {
        patientUserId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        patientDisplayName: 'Alex Kim',
        moreEpisodesOmitted: false,
        standaloneTimeline: [],
        episodesWithTimelines: [
          {
            episode: episodeRow(),
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
});
