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
  deleteEpisodeById,
  getActiveEpisodeForUser,
  listCompletedEpisodesForUser,
} from '@abstrack/supabase';
import type { EpisodeRow } from '@abstrack/types';
import { announce } from '@abstrack/ui/native';

import { clearSymptomPromptSession } from '../../lib/episodes/symptom-prompt-session-store';
import { getMobileAuthSessionSafe } from '../../lib/supabase-wiring';
import { AppThemeProvider } from '../theme/AppThemeContext';
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
        // Intentionally omit `fn` from deps: real focus runs on blur/unmount; re-running when
        // `loadInitial`’s identity changes simulates cancel and leaves `loading` stuck true.
      }, []);
    },
  };
});

jest.mock('@abstrack/supabase', () => ({
  cancelActiveEpisodeById: jest.fn(),
  deleteEpisodeById: jest.fn(),
  getActiveEpisodeForUser: jest.fn(),
  listCompletedEpisodesForUser: jest.fn(),
  resolvePhiSubjectUserContextFromSupabase: jest.fn(
    async (_client: unknown, authUserId: string) => ({
      ok: true as const,
      data: {
        authUserId,
        phiSubjectUserId: authUserId,
        profileAppRole: 'patient' as const,
      },
    }),
  ),
}));

jest.mock('@abstrack/ui/native', () => ({
  announce: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../lib/episodes/symptom-prompt-session-store', () => ({
  clearSymptomPromptSession: jest.fn(),
}));

/**
 * Mock the wiring barrel so {@link useMobileAuthUserId} and {@link EpisodesManagementPanel}’s
 * `getMobileAuthSessionSafe` use the same controllable session (not the real ChunkingSecureStore path).
 */
jest.mock('../../lib/supabase-wiring', () => ({
  __esModule: true,
  getMobileSupabaseClient: jest.fn(() => ({
    mockClient: true,
    auth: {
      storageKey: 'sb-test-auth-token',
      getUser: jest.fn(async () => ({
        data: { user: { id: 'user-1' } },
      })),
      getSession: jest.fn(async () => ({
        data: { session: { user: { id: 'user-1' } } },
      })),
    },
  })),
  getMobileAuthSessionSafe: jest.fn(async () => ({
    data: { session: { user: { id: 'user-1' } } },
    error: null,
  })),
  readPersistedMobileAuthUserId: jest.fn(async () => 'user-1'),
  mobileAuthStorage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
  createMobileSupabaseClient: jest.fn(() => {
    throw new Error(
      'createMobileSupabaseClient not used in EpisodesScreen tests',
    );
  }),
}));

jest.mock('../../lib/network/mobile-device-netinfo', () => ({
  __esModule: true,
  fetchMobileDeviceIsConnected: jest.fn(async () => true),
}));

function makeEpisodeRow(overrides: Partial<EpisodeRow> = {}): EpisodeRow {
  return {
    id: 'ep-1',
    user_id: 'user-1',
    symptom_preset_id: 'sym-1',
    health_marker_preset_id: null,
    episode_type: 'ABS',
    episode_label: null,
    additional_notes: null,
    note: null,
    started_at: '2026-04-20T10:00:00.000Z',
    ended_at: null,
    post_marker_step_completed_at: null,
    created_at: '2026-04-20T10:00:00.000Z',
    updated_at: '2026-04-20T10:00:00.000Z',
    ...overrides,
  };
}

function renderEpisodesScreen() {
  return render(
    <AppThemeProvider>
      <EpisodesScreen />
    </AppThemeProvider>,
  );
}

describe('EpisodesScreen', () => {
  const mockNavigate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    jest.mocked(getMobileAuthSessionSafe).mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    } as never);

    jest.mocked(useNavigation).mockReturnValue({
      navigate: mockNavigate,
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
    jest.mocked(deleteEpisodeById).mockResolvedValue({
      ok: true,
      data: { didDelete: true },
    });
  });

  it('shows loading text until load finishes', async () => {
    let resolveSession!: (v: {
      data: { session: { user: { id: string } } | null };
      error: null;
    }) => void;
    const sessionPromise = new Promise<{
      data: { session: { user: { id: string } } | null };
      error: null;
    }>((resolve) => {
      resolveSession = resolve;
    });
    jest
      .mocked(getMobileAuthSessionSafe)
      .mockReturnValue(sessionPromise as never);

    renderEpisodesScreen();

    expect(screen.getByText('Loading…')).toBeTruthy();

    await act(async () => {
      resolveSession({ data: { session: null }, error: null });
    });

    await waitFor(() => {
      expect(screen.queryByText('Loading…')).toBeNull();
    });

    expect(await screen.findByText('No episode in progress.')).toBeTruthy();
  });

  it('shows empty signed-out-style copy when user is null', async () => {
    jest.mocked(getMobileAuthSessionSafe).mockResolvedValue({
      data: { session: null },
      error: null,
    } as never);

    renderEpisodesScreen();

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

    renderEpisodesScreen();

    expect(await screen.findByText('Active query failed')).toBeTruthy();
    expect(await screen.findByText('Recent query failed')).toBeTruthy();
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

    renderEpisodesScreen();

    const resumeBtn = await screen.findByLabelText('Resume this episode');
    fireEvent.press(resumeBtn);

    expect(mockNavigate).toHaveBeenCalledWith('SymptomPrompt', {
      episodeId: 'ep-resume',
      symptomPresetId: 'preset-99',
      resume: true,
    });
  });

  it('navigates to HealthMarkerPrompt when episode is at end step', async () => {
    const active = makeEpisodeRow({
      id: 'ep-end-step',
      symptom_preset_id: null,
      health_marker_preset_id: 'hm-end-step',
      post_marker_step_completed_at: '2026-04-20T12:00:00.000Z',
    });
    jest.mocked(getActiveEpisodeForUser).mockResolvedValue({
      ok: true,
      data: active,
    });

    renderEpisodesScreen();

    const resumeBtn = await screen.findByLabelText('Resume this episode');
    fireEvent.press(resumeBtn);

    expect(mockNavigate).toHaveBeenCalledWith('HealthMarkerPrompt', {
      episodeId: 'ep-end-step',
      resume: true,
      hub: true,
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

    renderEpisodesScreen();

    expect(await screen.findByText('ABS — Test label')).toBeTruthy();
    expect(screen.getByText('Ended')).toBeTruthy();
  });

  it('confirms and deletes a completed episode from history', async () => {
    const alertSpy = jest
      .spyOn(require('react-native').Alert, 'alert')
      .mockImplementation(() => undefined);
    try {
      const ended = makeEpisodeRow({
        id: 'ep-ended-delete',
        ended_at: '2026-04-21T12:00:00.000Z',
        episode_label: 'History row',
      });
      jest.mocked(listCompletedEpisodesForUser).mockResolvedValue({
        ok: true,
        data: [ended],
      });

      renderEpisodesScreen();

      expect(await screen.findByText('ABS — History row')).toBeTruthy();
      fireEvent.press(screen.getByText('Delete episode'));

      expect(alertSpy).toHaveBeenCalledWith(
        'Delete this episode from history?',
        'Deleting permanently removes this episode, its symptom answers, health markers, and media metadata. Food diary entries are kept, but this episode link is removed. This cannot be undone.',
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
        expect(deleteEpisodeById).toHaveBeenCalledWith(
          expect.anything(),
          'ep-ended-delete',
        );
      });
      expect(announce).toHaveBeenCalledWith('Episode deleted from history.', {
        politeness: 'polite',
      });
    } finally {
      alertSpy.mockRestore();
    }
  });

  it('confirms and cancels active episode', async () => {
    const alertSpy = jest
      .spyOn(require('react-native').Alert, 'alert')
      .mockImplementation(() => undefined);
    try {
      const active = makeEpisodeRow({
        id: 'ep-cancel',
        symptom_preset_id: 'preset-1',
      });
      jest.mocked(getActiveEpisodeForUser).mockResolvedValue({
        ok: true,
        data: active,
      });

      renderEpisodesScreen();

      expect(await screen.findByLabelText('Cancel episode')).toBeTruthy();
      fireEvent.press(screen.getByLabelText('Cancel episode'));

      expect(alertSpy).toHaveBeenCalledWith(
        'Cancel this active episode?',
        'Canceling permanently deletes this in-progress episode, its symptom answers, health markers, and media metadata. Food diary entries are kept, but this episode link is removed. This cannot be undone.',
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
    } finally {
      alertSpy.mockRestore();
    }
  });
});
