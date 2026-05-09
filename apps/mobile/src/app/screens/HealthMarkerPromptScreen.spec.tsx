import * as React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { DefaultTheme } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  cancelActiveEpisodeById,
  completeEpisodePostMarkerStep,
  createFoodDiaryEntry,
  endEpisodeIfStillActive,
  getEpisodeById,
  listFoodDiaryEntriesForEpisode,
  listEpisodeHealthMarkersForEpisode,
  listEpisodeObservationTimeline,
  listPresetHealthMarkersForPreset,
  PresetDataError,
  updateFoodDiaryEntry,
  insertEpisodeHealthMarkerForLine,
} from '@abstrack/supabase';
import type { PresetHealthMarkerRow } from '@abstrack/types';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import { useAppTheme } from '../theme/AppThemeContext';
import { lightAppColors } from '../theme/app-colors';
import { HealthMarkerPromptScreen } from './HealthMarkerPromptScreen';

/**
 * In-memory timeline sort/merge matching {@link compareEpisodeTimelineItems} /
 * {@link upsertEpisodeTimelineItem} in `@abstrack/supabase` (avoids loading the full package barrel in Jest).
 */
type MockTimelineItem = {
  kind: string;
  sortAt: string;
  id: string;
  label: string;
  detail: string;
};

/**
 * Mirrors {@link compareEpisodeTimelineItems} ordering closely enough for tests.
 *
 * **Important:** `Array.sort` requires a **consistent** comparator (transitivity). The naive split
 * “both finite → numeric else string” is wrong when exactly one side parses: you must not compare
 * parsed vs unparsed timestamps in the string branch. A broken comparator can make V8’s sort spin or
 * misbehave badly under load.
 */
function mockCompareEpisodeTimelineItems(
  a: MockTimelineItem,
  b: MockTimelineItem,
): number {
  const aMs = Date.parse(a.sortAt);
  const bMs = Date.parse(b.sortAt);
  const aValid = Number.isFinite(aMs);
  const bValid = Number.isFinite(bMs);

  if (aValid && bValid) {
    const c = aMs - bMs;
    if (c !== 0) {
      return c;
    }
  } else if (!aValid && !bValid) {
    const c = a.sortAt.localeCompare(b.sortAt);
    if (c !== 0) {
      return c;
    }
  } else {
    // Exactly one parses: order deterministically without mixing number vs string compare.
    return aValid ? -1 : 1;
  }

  return a.id.localeCompare(b.id);
}

function mockUpsertEpisodeTimelineItem(
  prev: MockTimelineItem[],
  next: MockTimelineItem,
): MockTimelineItem[] {
  const rows = prev.filter((r) => !(r.kind === next.kind && r.id === next.id));
  rows.push(next);
  rows.sort(mockCompareEpisodeTimelineItems);
  return rows;
}

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: jest.fn(),
  useNavigation: jest.fn(),
}));

jest.mock('@abstrack/supabase', () => {
  const preset = jest.requireActual<
    typeof import('../../../../../packages/supabase/src/lib/preset-data-error')
  >('../../../../../packages/supabase/src/lib/preset-data-error.ts');
  const { isMealTag } =
    jest.requireActual<typeof import('@abstrack/types')>('@abstrack/types');
  const { PresetDataError } = preset;

  /**
   * Subset of {@link validateAndNormalizeFoodDiaryCreateCore} / {@link normalizeFoodDiaryEntryUpdate}
   * (Jest cannot load `food-diary-data.ts` via `requireActual` because that module uses `.js` specifiers).
   */
  function mockNormalizeFoodNote(note: string): string | null {
    const next = note.trim();
    return next.length > 0 ? next : null;
  }

  function mockNormalizeOptionalIso(
    value: string | null | undefined,
  ): string | null {
    if (value == null) {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const ms = Date.parse(trimmed);
    if (!Number.isFinite(ms)) {
      return null;
    }
    return new Date(ms).toISOString();
  }

  function mockValidateAndNormalizeFoodDiaryCreateCore(payload: {
    meal_tag: string;
    food_note: string;
    logged_at: string;
  }):
    | { ok: true; food_note: string; logged_at: string }
    | { ok: false; error: InstanceType<typeof PresetDataError> } {
    if (!isMealTag(payload.meal_tag)) {
      return {
        ok: false,
        error: new PresetDataError(
          'validation_error',
          'Choose a valid meal tag (Breakfast, Lunch, Dinner, Snack, or Other).',
        ),
      };
    }
    const foodNote = mockNormalizeFoodNote(payload.food_note);
    if (!foodNote) {
      return {
        ok: false,
        error: new PresetDataError(
          'validation_error',
          'Enter what you ate or drank before saving.',
        ),
      };
    }
    const loggedAt = mockNormalizeOptionalIso(payload.logged_at);
    if (!loggedAt) {
      return {
        ok: false,
        error: new PresetDataError(
          'validation_error',
          'Enter a valid date and time.',
        ),
      };
    }
    return { ok: true, food_note: foodNote, logged_at: loggedAt };
  }

  function mockNormalizeFoodDiaryEntryUpdate(patch: Record<string, unknown>):
    | {
        ok: true;
        data: Record<string, unknown>;
      }
    | { ok: false; error: InstanceType<typeof PresetDataError> } {
    const normalizedPatch: Record<string, unknown> = { ...patch };
    if (normalizedPatch.food_note !== undefined) {
      const next = mockNormalizeFoodNote(String(normalizedPatch.food_note));
      if (!next) {
        return {
          ok: false,
          error: new PresetDataError(
            'validation_error',
            'Enter what you ate or drank before saving.',
          ),
        };
      }
      normalizedPatch.food_note = next;
    }
    if (
      normalizedPatch.meal_tag !== undefined &&
      !isMealTag(normalizedPatch.meal_tag)
    ) {
      return {
        ok: false,
        error: new PresetDataError(
          'validation_error',
          'Choose a valid meal tag (Breakfast, Lunch, Dinner, Snack, or Other).',
        ),
      };
    }
    if (normalizedPatch.logged_at !== undefined) {
      const loggedAt = mockNormalizeOptionalIso(
        normalizedPatch.logged_at as string,
      );
      if (!loggedAt) {
        return {
          ok: false,
          error: new PresetDataError(
            'validation_error',
            'Enter a valid date and time.',
          ),
        };
      }
      normalizedPatch.logged_at = loggedAt;
    }
    return { ok: true, data: normalizedPatch };
  }

  return {
    PresetDataError,
    toPresetDataError: preset.toPresetDataError,
    mapSupabaseErrorToPresetDataError: preset.mapSupabaseErrorToPresetDataError,
    normalizeFoodDiaryEntryUpdate: mockNormalizeFoodDiaryEntryUpdate,
    validateAndNormalizeFoodDiaryCreateCore:
      mockValidateAndNormalizeFoodDiaryCreateCore,
    compareEpisodeTimelineItems: mockCompareEpisodeTimelineItems,
    upsertEpisodeTimelineItem: mockUpsertEpisodeTimelineItem,
    cancelActiveEpisodeById: jest.fn(),
    completeEpisodePostMarkerStep: jest.fn(),
    createFoodDiaryEntry: jest.fn(),
    deleteCurrentPassEpisodeSymptomAnswer: jest.fn(),
    deleteEpisodeById: jest.fn(),
    deleteFoodDiaryEntry: jest.fn(),
    endEpisodeIfStillActive: jest.fn(),
    getEpisodeById: jest.fn(),
    insertEpisodeHealthMarkerForLine: jest.fn(),
    insertEpisodeSymptomAnswer: jest.fn(),
    listEpisodeHealthMarkersForEpisode: jest.fn(),
    listEpisodeObservationTimeline: jest.fn(async () => ({
      ok: true,
      data: [],
    })),
    listFoodDiaryEntriesForEpisode: jest.fn(),
    listPresetHealthMarkersForPreset: jest.fn(),
    updateFoodDiaryEntry: jest.fn(),
  };
});

jest.mock('../../lib/network/mobile-device-netinfo', () => ({
  __esModule: true,
  fetchMobileDeviceIsConnected: jest.fn(async () => true),
}));

/**
 * Avoid loading the real gateway (PowerSync writes, NetInfo gating, extra deps). Delegate REST
 * paths to the same `@abstrack/supabase` jest mocks {@link beforeEach} configures.
 */
jest.mock('../../lib/episodes/mobile-offline-first-gateway', () => ({
  __esModule: true,
  insertEpisodeHealthMarkerLineOfflineFirst: jest.fn(
    async (client: unknown, _db: unknown, args: unknown) =>
      (
        jest.requireMock('@abstrack/supabase') as any
      ).insertEpisodeHealthMarkerForLine(client as never, args as never),
  ),
  listEpisodeHealthMarkersForEpisodeOfflineFirst: jest.fn(
    async (
      client: unknown,
      _db: unknown,
      episodeId: unknown,
      options: { limit?: number } = {},
    ) => {
      const supabase = jest.requireMock('@abstrack/supabase') as any;
      const r = await supabase.listEpisodeHealthMarkersForEpisode(
        client as never,
        episodeId as never,
        options,
      );
      if (!r.ok) {
        return r;
      }
      return {
        ok: true as const,
        data: r.data,
        markersReadFromLocalReplica: false,
      };
    },
  ),
  completeEpisodePostMarkerStepOfflineFirst: jest.fn(
    async (
      client: unknown,
      _db: unknown,
      episodeId: unknown,
      fields: unknown,
    ) =>
      (
        jest.requireMock('@abstrack/supabase') as any
      ).completeEpisodePostMarkerStep(
        client as never,
        episodeId as never,
        fields as never,
      ),
  ),
  endEpisodeIfStillActiveOfflineFirst: jest.fn(
    async (
      client: unknown,
      _db: unknown,
      episodeId: unknown,
      endedAt?: unknown,
      startedAt?: unknown,
    ) =>
      (jest.requireMock('@abstrack/supabase') as any).endEpisodeIfStillActive(
        client as never,
        episodeId as never,
        endedAt as never,
        startedAt as never,
      ),
  ),
  cancelActiveEpisodeByIdOfflineFirst: jest.fn(
    async (client: unknown, _db: unknown, episodeId: unknown) =>
      (jest.requireMock('@abstrack/supabase') as any).cancelActiveEpisodeById(
        client as never,
        episodeId as never,
      ),
  ),
  listFoodDiaryEntriesForEpisodeOfflineFirst: jest.fn(
    async (
      client: unknown,
      _db: unknown,
      episodeId: unknown,
      options: { limit?: number; trustEmptyLocalReplica?: boolean } = {},
    ) =>
      (
        jest.requireMock('@abstrack/supabase') as any
      ).listFoodDiaryEntriesForEpisode(
        client as never,
        episodeId as never,
        options,
      ),
  ),
  createFoodDiaryEntryOfflineFirst: jest.fn(
    async (client: unknown, _db: unknown, row: Record<string, unknown>) => {
      const supabase = jest.requireMock('@abstrack/supabase') as any;
      const core = supabase.validateAndNormalizeFoodDiaryCreateCore(
        row as never,
      );
      if (!core.ok) {
        return core;
      }
      return supabase.createFoodDiaryEntry(
        client as never,
        {
          ...row,
          food_note: core.food_note,
          logged_at: core.logged_at,
        } as never,
      );
    },
  ),
  updateFoodDiaryEntryOfflineFirst: jest.fn(
    async (client: unknown, _db: unknown, entryId: unknown, patch: unknown) => {
      const supabase = jest.requireMock('@abstrack/supabase') as any;
      const normalized = supabase.normalizeFoodDiaryEntryUpdate(patch as never);
      if (!normalized.ok) {
        return normalized;
      }
      return supabase.updateFoodDiaryEntry(
        client as never,
        entryId as never,
        normalized.data as never,
      );
    },
  ),
  deleteFoodDiaryEntryOfflineFirst: jest.fn(
    async (client: unknown, _db: unknown, entryId: unknown) =>
      (jest.requireMock('@abstrack/supabase') as any).deleteFoodDiaryEntry(
        client as never,
        entryId as never,
      ),
  ),
}));

jest.mock('../../lib/powersync/PowerSyncSessionBridge', () => {
  /**
   * Single object identity: {@link HealthMarkerPromptScreen} puts `psBridge` in `useEffect` /
   * `useMemo` deps; a fresh literal from the mock each render changes the dependency every time and
   * retriggers load → `setStatus` → infinite updates.
   */
  const stablePsBridgeState = {
    syncChromeEnabled: false,
    powerSyncUrlConfigured: false,
    database: null,
    firstSyncCompleted: false,
    localSqliteInitialized: false,
    syncConnecting: false,
    syncError: null,
    firstSyncLandedOnDevice: false,
    firstSyncLandingHydrated: true,
  };

  const stableManualResync = {
    requestManualResync: jest.fn().mockResolvedValue(true),
    manualResyncBusy: false,
  };

  return {
    usePowerSyncBridgeState: jest.fn(() => stablePsBridgeState),
    usePowerSyncManualResync: jest.fn(() => stableManualResync),
    powerSyncOfflineReplicaReadsEnabled: jest.fn(() => false),
    powerSyncReplicaSqliteReady: jest.fn(() => false),
  };
});

/**
 * `use-health-marker-food-diary` imports `get-mobile-auth-session-safe` **directly** (not the
 * barrel). Mock it so that module never pulls `supabase-wiring-core` / ChunkingSecureStore.
 */
jest.mock('../../lib/get-mobile-auth-session-safe', () => ({
  __esModule: true,
  MOBILE_AUTH_SESSION_RECOVERY_USER_MESSAGE:
    "We couldn't verify your sign-in. Try again in a moment, or sign out and sign back in.",
  isAuthSessionRecoveryFailure: (error: unknown): boolean =>
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'auth_session_recovery_failed',
  isPersistedSupabaseSessionAccessExpired: jest.fn(() => false),
  hasUsableSupabaseAccessTokenForNetwork: jest.fn(() => true),
  persistedSessionIdentityWithRedactedAccessJwt: (session: {
    access_token?: string;
    user?: { id: string };
  }) => ({
    ...session,
    access_token: '',
  }),
  getMobileAuthSessionSafe: jest.fn(async () => ({
    data: { session: { user: { id: 'test-user-1' } } },
    error: null,
  })),
  readPersistedMobileAuthUserId: jest.fn(async () => 'test-user-1'),
}));

/**
 * Mock the **barrel** so `HealthMarkerPromptScreen`’s `from '../../lib/supabase-wiring'` never loads
 * the real re-export graph (which would execute `supabase-wiring-core` at module scope).
 */
jest.mock('../../lib/supabase-wiring', () => {
  const safe =
    require('../../lib/get-mobile-auth-session-safe') as typeof import('../../lib/get-mobile-auth-session-safe');
  return {
    __esModule: true,
    getMobileSupabaseClient: jest.fn(() => ({
      mockClient: true,
      auth: {
        storageKey: 'sb-test-auth-token',
        getUser: jest.fn(async () => ({
          data: { user: { id: 'test-user-1' } },
        })),
        getSession: jest.fn(async () => ({
          data: { session: { user: { id: 'test-user-1' } } },
        })),
      },
    })),
    mobileAuthStorage: {
      getItem: jest.fn(async () => null),
      setItem: jest.fn(async () => undefined),
      removeItem: jest.fn(async () => undefined),
    },
    createMobileSupabaseClient: jest.fn(() => {
      throw new Error(
        'createMobileSupabaseClient not used in HealthMarkerPromptScreen tests',
      );
    }),
    getMobileAuthSessionSafe: safe.getMobileAuthSessionSafe,
    readPersistedMobileAuthUserId: safe.readPersistedMobileAuthUserId,
    isAuthSessionRecoveryFailure: safe.isAuthSessionRecoveryFailure,
    MOBILE_AUTH_SESSION_RECOVERY_USER_MESSAGE:
      safe.MOBILE_AUTH_SESSION_RECOVERY_USER_MESSAGE,
    isPersistedSupabaseSessionAccessExpired:
      safe.isPersistedSupabaseSessionAccessExpired,
    hasUsableSupabaseAccessTokenForNetwork:
      safe.hasUsableSupabaseAccessTokenForNetwork,
    persistedSessionIdentityWithRedactedAccessJwt:
      safe.persistedSessionIdentityWithRedactedAccessJwt,
  };
});

jest.mock('../theme/AppThemeContext', () => ({
  useAppTheme: jest.fn(),
}));

jest.mock('@abstrack/ui/native', () => ({
  __esModule: true,
  announce: jest.fn(async () => undefined),
  /** Same value as {@link COMFORTABLE_TOUCH_TARGET_DP} in `@abstrack/ui/native` (screen layout only). */
  COMFORTABLE_TOUCH_TARGET_DP: 48,
}));

const episodeId = 'episode-1';
const markerPresetId = 'hm-preset-1';

function makeLine(
  id: string,
  sortOrder: number,
  markerKind: PresetHealthMarkerRow['marker_kind'],
  customName: string | null = null,
  customUnit: string | null = null,
): PresetHealthMarkerRow {
  return {
    id,
    preset_id: markerPresetId,
    sort_order: sortOrder,
    marker_kind: markerKind,
    custom_name: customName,
    custom_unit: customUnit,
    created_at: '2020-01-01T00:00:00Z',
    updated_at: '2020-01-01T00:00:00Z',
  };
}

describe('HealthMarkerPromptScreen', () => {
  const mockDispatch = jest.fn();
  const mockReplace = jest.fn();

  const lineA = makeLine('hm-a', 0, 'blood_glucose');
  const lineB = makeLine('hm-b', 1, 'heart_rate');
  const lineBp = makeLine('hm-bp', 0, 'blood_pressure');

  beforeEach(() => {
    jest.clearAllMocks();

    jest.mocked(useRoute).mockReturnValue({
      key: 'HealthMarkerPrompt',
      name: 'HealthMarkerPrompt',
      params: { episodeId, resume: false },
    } as never);

    jest.mocked(useNavigation).mockReturnValue({
      dispatch: mockDispatch,
      replace: mockReplace,
      addListener: jest.fn(() => jest.fn()),
    } as never);

    jest.mocked(useAppTheme).mockReturnValue({
      colorScheme: 'light',
      colors: lightAppColors,
      themePreference: 'system',
      setThemePreference: jest.fn(() => Promise.resolve()),
      navigationTheme: DefaultTheme,
      statusBarStyle: 'dark',
    });

    jest.mocked(getEpisodeById).mockResolvedValue({
      ok: true,
      data: {
        id: episodeId,
        user_id: 'test-user-1',
        symptom_preset_id: 'sym-preset-1',
        health_marker_preset_id: markerPresetId,
        episode_type: 'ABS',
        episode_label: null,
        additional_notes: null,
        note: null,
        started_at: '2020-01-01T00:00:00Z',
        ended_at: null,
        post_marker_step_completed_at: null,
        created_at: '2020-01-01T00:00:00Z',
        updated_at: '2020-01-01T00:00:00Z',
      },
    });
    jest.mocked(listPresetHealthMarkersForPreset).mockResolvedValue({
      ok: true,
      data: [lineA, lineB],
    });
    jest.mocked(listEpisodeHealthMarkersForEpisode).mockResolvedValue({
      ok: true,
      data: [],
    });
    jest.mocked(insertEpisodeHealthMarkerForLine).mockResolvedValue({
      ok: true,
      data: {
        id: 'hm-row-1',
        user_id: 'test-user-1',
        episode_id: episodeId,
        preset_health_marker_id: 'hm-a',
        marker_kind: 'blood_glucose',
        custom_name: null,
        custom_name_key: '',
        custom_unit: null,
        custom_unit_key: '',
        value_numeric: 120,
        systolic_numeric: null,
        diastolic_numeric: null,
        recorded_at: '2020-01-01T00:00:00Z',
        notes: null,
        created_at: '2020-01-01T00:00:00Z',
        updated_at: '2020-01-01T00:00:00Z',
      },
    });
    jest.mocked(cancelActiveEpisodeById).mockResolvedValue({
      ok: true,
      data: { didCancel: true },
    });
    jest.mocked(completeEpisodePostMarkerStep).mockResolvedValue({
      ok: true,
      data: {
        id: episodeId,
        user_id: 'test-user-1',
        symptom_preset_id: 'sym-preset-1',
        health_marker_preset_id: markerPresetId,
        episode_type: 'Other',
        episode_label: null,
        additional_notes: null,
        note: null,
        started_at: '2020-01-01T00:00:00Z',
        ended_at: null,
        post_marker_step_completed_at: '2020-01-01T01:00:00Z',
        created_at: '2020-01-01T00:00:00Z',
        updated_at: '2020-01-01T01:00:00Z',
      },
    });
    jest.mocked(endEpisodeIfStillActive).mockResolvedValue({
      ok: true,
      data: { didEnd: true },
    });
    jest.mocked(createFoodDiaryEntry).mockResolvedValue({
      ok: true,
      data: {
        id: 'food-1',
        user_id: 'test-user-1',
        episode_id: episodeId,
        meal_tag: 'Other',
        food_note: 'Snack',
        logged_at: '2020-01-01T01:30:00Z',
        created_at: '2020-01-01T01:30:00Z',
        updated_at: '2020-01-01T01:30:00Z',
      },
    });
    jest.mocked(updateFoodDiaryEntry).mockResolvedValue({
      ok: true,
      data: {
        id: 'food-1',
        user_id: 'test-user-1',
        episode_id: episodeId,
        meal_tag: 'Snack',
        food_note: 'Updated note',
        logged_at: '2020-01-01T01:30:00Z',
        created_at: '2020-01-01T01:30:00Z',
        updated_at: '2020-01-01T01:31:00Z',
      },
    });
    jest.mocked(listFoodDiaryEntriesForEpisode).mockResolvedValue({
      ok: true,
      data: [],
    });
  });

  test('loads marker preset lines and shows first step', async () => {
    const screen = render(<HealthMarkerPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });

    expect(screen.getByText('Glucose')).toBeTruthy();
    expect(listPresetHealthMarkersForPreset).toHaveBeenCalledWith(
      expect.objectContaining({ mockClient: true }),
      markerPresetId,
    );
    expect(getMobileSupabaseClient).toHaveBeenCalled();
  });

  test('hub resume does not bypass flow when post-marker boundary is missing', async () => {
    jest.mocked(useRoute).mockReturnValue({
      key: 'HealthMarkerPrompt',
      name: 'HealthMarkerPrompt',
      params: { episodeId, resume: true, hub: true },
    } as never);

    const screen = render(<HealthMarkerPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });
    expect(screen.queryByLabelText('Log another check-in')).toBeNull();
  });

  test('validation blocks Next and does not upsert when numeric value missing', async () => {
    const screen = render(<HealthMarkerPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Next health marker'));

    await waitFor(() => {
      expect(
        screen.getByText('Enter a numeric value to continue.'),
      ).toBeTruthy();
    });
    expect(insertEpisodeHealthMarkerForLine).not.toHaveBeenCalled();
  });

  test('Skip advances to next marker when current line is unanswered', async () => {
    const screen = render(<HealthMarkerPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Skip this marker'));

    await waitFor(() => {
      expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    });
    expect(screen.getByText('Heart rate')).toBeTruthy();
  });

  test('Next upserts with expected payload and advances', async () => {
    const screen = render(<HealthMarkerPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByLabelText('Marker value'), '123.4');
    fireEvent.changeText(screen.getByLabelText('Marker notes'), 'before meal');
    fireEvent.press(screen.getByLabelText('Next health marker'));

    await waitFor(() => {
      expect(insertEpisodeHealthMarkerForLine).toHaveBeenCalledTimes(1);
    });
    expect(insertEpisodeHealthMarkerForLine).toHaveBeenCalledWith(
      expect.objectContaining({ mockClient: true }),
      expect.objectContaining({
        userId: 'test-user-1',
        episodeId,
        line: lineA,
        valueNumeric: 123.4,
        systolicNumeric: null,
        diastolicNumeric: null,
        notes: 'before meal',
      }),
    );
    await waitFor(() => {
      expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    });
    expect(listEpisodeObservationTimeline).toHaveBeenCalledTimes(1);
  });

  test('blood pressure validation blocks when either value missing', async () => {
    jest.mocked(listPresetHealthMarkersForPreset).mockResolvedValue({
      ok: true,
      data: [lineBp],
    });

    const screen = render(<HealthMarkerPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 1')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByLabelText('Systolic value'), '120');

    const skip = screen.getByLabelText('Skip this marker');
    expect(skip.props.accessibilityState?.disabled).toBe(false);

    fireEvent.press(screen.getByLabelText('Continue to food diary'));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Enter both systolic and diastolic blood pressure values to continue.',
        ),
      ).toBeTruthy();
    });
    expect(insertEpisodeHealthMarkerForLine).not.toHaveBeenCalled();
  });

  test('food diary comes before episode details, then save opens episode hub with log another check-in', async () => {
    jest.mocked(listPresetHealthMarkersForPreset).mockResolvedValue({
      ok: true,
      data: [lineA],
    });

    const screen = render(<HealthMarkerPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 1')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByLabelText('Marker value'), '100');
    fireEvent.press(screen.getByLabelText('Continue to food diary'));

    await waitFor(() => {
      expect(screen.getByText('Food diary')).toBeTruthy();
    });
    expect(
      screen.getByText(
        'Add one or more meals/snacks for this episode, or skip this step.',
      ),
    ).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Skip food diary entry'));

    await waitFor(() => {
      expect(screen.getByText('Episode details')).toBeTruthy();
    });
    expect(
      screen.getByText(
        'After health markers and food diary, choose ABS or Other; other fields are optional.',
      ),
    ).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Other episode type'));
    fireEvent.changeText(
      screen.getByLabelText('Custom episode label'),
      'Evening flare',
    );
    fireEvent.changeText(
      screen.getByLabelText('Additional symptoms or markers'),
      'Extra symptom text',
    );
    fireEvent.changeText(screen.getByLabelText('Episode note'), 'Felt off');

    fireEvent.press(screen.getByLabelText('Save episode details'));

    await waitFor(() => {
      expect(completeEpisodePostMarkerStep).toHaveBeenCalledTimes(1);
    });
    expect(completeEpisodePostMarkerStep).toHaveBeenCalledWith(
      expect.objectContaining({ mockClient: true }),
      episodeId,
      expect.objectContaining({
        episode_type: 'Other',
        episode_label: 'Evening flare',
        additional_notes: 'Extra symptom text',
        note: 'Felt off',
        post_marker_step_completed_at: null,
      }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Log another check-in')).toBeTruthy();
    });
    expect(mockReplace).not.toHaveBeenCalledWith(
      'SymptomPrompt',
      expect.anything(),
    );
  });

  test('post-marker save failure shows postFeedback', async () => {
    jest.mocked(listPresetHealthMarkersForPreset).mockResolvedValue({
      ok: true,
      data: [lineA],
    });
    jest.mocked(completeEpisodePostMarkerStep).mockResolvedValue({
      ok: false,
      error: new PresetDataError(
        'not_found',
        'Could not save episode details. This episode may be missing, already ended, or no longer available.',
      ),
    });

    const screen = render(<HealthMarkerPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 1')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByLabelText('Marker value'), '5');
    fireEvent.press(screen.getByLabelText('Continue to food diary'));

    await waitFor(() => {
      expect(screen.getByText('Food diary')).toBeTruthy();
    });
    fireEvent.press(screen.getByLabelText('Skip food diary entry'));
    await waitFor(() => {
      expect(screen.getByText('Episode details')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Save episode details'));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Could not save episode details. This episode may be missing, already ended, or no longer available.',
        ),
      ).toBeTruthy();
    });
    expect(screen.getByText('Episode details')).toBeTruthy();
  });
});
