import * as React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { useNavigation } from '@react-navigation/native';
import {
  cancelActiveEpisodeById,
  getActiveEpisodeForUser,
  listCompletedEpisodesForUser,
} from '@abstrack/supabase';
import type { EpisodeRow } from '@abstrack/types';
import { announce } from '@abstrack/ui/native';

import { clearSymptomPromptSession } from '../../lib/episodes/symptom-prompt-session-store';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import { EpisodesScreen } from './EpisodesScreen';

jest.mock('@react-navigation/native', () => {
  const ReactNav = require('react');
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: jest.fn(),
    useFocusEffect: (fn: () => void | (() => void)) => {
      ReactNav.useEffect(() => {
        const cleanup = fn();
        return typeof cleanup === 'function' ? cleanup : undefined;
      }, [fn]);
    },
  };
});

jest.mock('@abstrack/supabase', () => ({
  cancelActiveEpisodeById: jest.fn(),
  getActiveEpisodeForUser: jest.fn(),
  listCompletedEpisodesForUser: jest.fn(),
}));

jest.mock('@abstrack/ui/native', () => ({
  announce: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../lib/episodes/symptom-prompt-session-store', () => ({
  clearSymptomPromptSession: jest.fn(),
}));

jest.mock('../../lib/supabase-wiring', () => ({
  getMobileSupabaseClient: jest.fn(),
}));

function makeEpisodeRow(overrides: Partial<EpisodeRow> = {}): EpisodeRow {
  return {
    id: 'ep-1',
    user_id: 'user-1',
    symptom_preset_id: 'sym-1',
    health_marker_preset_id: null,
    episode_type: 'ABS',
    episode_label: null,
    note: null,
    started_at: '2026-04-20T10:00:00.000Z',
    ended_at: null,
    created_at: '2026-04-20T10:00:00.000Z',
    updated_at: '2026-04-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('EpisodesScreen', () => {
  const mockNavigate = jest.fn();
  const mockGetUser = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    jest.mocked(useNavigation).mockReturnValue({
      navigate: mockNavigate,
    } as never);

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    jest.mocked(getMobileSupabaseClient).mockReturnValue({
      auth: {
        getUser: mockGetUser,
      },
    } as never);

    jest.mocked(getActiveEpisodeForUser).mockResolvedValue({
      ok: true,
      data: null,
    });
    jest.mocked(listCompletedEpisodesForUser).mockResolvedValue({
      ok: true,
      data: [],
    });
    jest.mocked(cancelActiveEpisodeById).mockResolvedValue({
      ok: true,
      data: { didCancel: true },
    });
  });

  it('shows loading text until load finishes', async () => {
    let resolveGetUser!: (v: { data: { user: { id: string } | null } }) => void;
    const getUserPromise = new Promise<{
      data: { user: { id: string } | null };
    }>((resolve) => {
      resolveGetUser = resolve;
    });
    mockGetUser.mockReturnValue(getUserPromise);

    render(<EpisodesScreen />);

    expect(screen.getByText('Loading…')).toBeTruthy();

    await act(async () => {
      resolveGetUser({ data: { user: null } });
    });

    await waitFor(() => {
      expect(screen.queryByText('Loading…')).toBeNull();
    });

    expect(await screen.findByText('No episode in progress.')).toBeTruthy();
  });

  it('shows empty signed-out-style copy when user is null', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    render(<EpisodesScreen />);

    expect(await screen.findByText('No episode in progress.')).toBeTruthy();
    expect(
      await screen.findByText('No ended episodes in your history yet.'),
    ).toBeTruthy();
  });

  it('surfaces active and recent API errors', async () => {
    jest.mocked(getActiveEpisodeForUser).mockResolvedValue({
      ok: false,
      error: { message: 'Active query failed' } as never,
    });
    jest.mocked(listCompletedEpisodesForUser).mockResolvedValue({
      ok: false,
      error: { message: 'Recent query failed' } as never,
    });

    render(<EpisodesScreen />);

    expect(await screen.findByText('Active query failed')).toBeTruthy();
    expect(await screen.findByText('Recent query failed')).toBeTruthy();
  });

  it('surfaces unified error when load throws', async () => {
    mockGetUser.mockRejectedValue(new Error('network'));

    render(<EpisodesScreen />);

    const alerts = await screen.findAllByText('Unable to load episodes.');
    expect(alerts).toHaveLength(2);
  });

  it('navigates to SymptomPrompt with resume when Resume is pressed', async () => {
    const active = makeEpisodeRow({
      id: 'ep-resume',
      symptom_preset_id: 'preset-99',
    });
    jest.mocked(getActiveEpisodeForUser).mockResolvedValue({
      ok: true,
      data: active,
    });

    render(<EpisodesScreen />);

    expect(await screen.findByLabelText('Resume this episode')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Resume this episode'));

    expect(mockNavigate).toHaveBeenCalledWith('SymptomPrompt', {
      episodeId: 'ep-resume',
      symptomPresetId: 'preset-99',
      resume: true,
    });
  });

  it('renders recent ended episodes when list returns rows', async () => {
    const ended = makeEpisodeRow({
      id: 'ep-ended',
      ended_at: '2026-04-21T12:00:00.000Z',
      episode_label: 'Test label',
    });
    jest.mocked(listCompletedEpisodesForUser).mockResolvedValue({
      ok: true,
      data: [ended],
    });

    render(<EpisodesScreen />);

    expect(await screen.findByText('ABS — Test label')).toBeTruthy();
    expect(screen.getByText('Ended')).toBeTruthy();
  });

  it('confirms and cancels active episode', async () => {
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert');
    const active = makeEpisodeRow({
      id: 'ep-cancel',
      symptom_preset_id: 'preset-1',
    });
    jest.mocked(getActiveEpisodeForUser).mockResolvedValue({
      ok: true,
      data: active,
    });

    render(<EpisodesScreen />);

    expect(await screen.findByLabelText('Cancel episode')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Cancel episode'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Cancel this active episode?',
      'Canceling will permanently remove this in-progress episode and any linked symptom or media entries. This cannot be undone.',
      expect.any(Array),
    );

    const [, , buttons] = alertSpy.mock.calls[0] as [
      string,
      string,
      Array<{ onPress?: () => void }>,
    ];
    await act(async () => {
      buttons[1]?.onPress?.();
    });

    await waitFor(() => {
      expect(cancelActiveEpisodeById).toHaveBeenCalledWith(
        expect.anything(),
        'ep-cancel',
      );
    });
    expect(clearSymptomPromptSession).toHaveBeenCalledWith('ep-cancel');
    expect(announce).toHaveBeenCalledWith(
      'Episode canceled. Resume is no longer available.',
      { politeness: 'polite' },
    );
  });
});
