import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  formatEpisodeDurationSimple,
  isMediaType,
  type EpisodeRow,
} from '@abstrack/types';
import { announce } from '@abstrack/ui/native';
import {
  createEpisodeMediaSignedDisplayUrl,
  getActiveEpisodeForUser,
  listEpisodeMediaForEpisode,
  listCompletedEpisodesForUser,
} from '@abstrack/supabase';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useMobileAuthUserId } from '../../lib/auth/use-mobile-auth-user-id';
import {
  cancelActiveEpisodeByIdOfflineFirst,
  deleteEpisodeByIdOfflineFirst,
} from '../../lib/episodes/mobile-offline-first-gateway';
import { clearSymptomPromptSession } from '../../lib/episodes/symptom-prompt-session-store';
import { POWERSYNC_OFFLINE_EPISODE_PAGE_SIZE } from '../../lib/powersync/episode-powersync-read';
import {
  PowerSyncEpisodeReadSubscriptions,
  type PowerSyncEpisodeReadSnapshots,
} from '../../lib/powersync/PowerSyncEpisodeReadSubscriptions';
import {
  powerSyncOfflineReplicaReadsEnabled,
  powerSyncReplicaSqliteReady,
  usePowerSyncBridgeState,
} from '../../lib/powersync/PowerSyncSessionBridge';
import { usePullToResyncPowerSync } from '../../lib/powersync/use-pull-to-resync-powersync';
import {
  getMobileAuthSessionSafe,
  getMobileSupabaseClient,
} from '../../lib/supabase-wiring';
import { ScreenShell } from '../components/ScreenShell';
import type { MainStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/AppThemeContext';
import { nw } from '../theme/app-nativewind-classes';

/** Matches Supabase `listCompletedEpisodesForUser` first page and default SQLite `LIMIT`. */
const RECENT_PAGE_SIZE = POWERSYNC_OFFLINE_EPISODE_PAGE_SIZE;

export type EpisodesManagementNav =
  NativeStackNavigationProp<MainStackParamList>;

function episodeSummaryLine(ep: {
  episode_type: string;
  episode_label: string | null;
}): string {
  const label = ep.episode_label?.trim();
  return label ? `${ep.episode_type} — ${label}` : ep.episode_type;
}

/** Localized instant for display; returns the raw `iso` (or em dash when empty) if parsing fails. */
function formatInstant(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso.trim() === '' ? '—' : iso;
  }
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export type EpisodesManagementPanelProps = {
  navigation: EpisodesManagementNav;
  /**
   * `standalone`: full screen with {@link ScreenShell} and page title (tests / legacy).
   * `embedded`: body only for the Manage tab.
   */
  variant?: 'standalone' | 'embedded';
  /** Inclusive lower bound on `ended_at` for completed history (ISO timestamptz). */
  endedAtOrAfter?: string | null;
  /** Inclusive upper bound on `ended_at` for completed history (ISO timestamptz). */
  endedAtOrBefore?: string | null;
};

/**
 * Active episode row, completed history, resume/cancel/delete actions, and paginated recent list.
 *
 * @param props - Navigation, layout variant, and optional date bounds for completed episodes.
 * @returns Episode management UI.
 */
export function EpisodesManagementPanel({
  navigation,
  variant = 'standalone',
  endedAtOrAfter = null,
  endedAtOrBefore = null,
}: EpisodesManagementPanelProps) {
  const { colors } = useAppTheme();
  const loadGenRef = useRef(0);
  const viewerUserId = useMobileAuthUserId();
  const psBridge = usePowerSyncBridgeState();
  const powerSyncDbForWrites = useMemo(
    () => (powerSyncReplicaSqliteReady(psBridge) ? psBridge.database : null),
    [psBridge],
  );
  const [psMirror, setPsMirror] = useState<PowerSyncEpisodeReadSnapshots>({
    activeEpisode: null,
    activeLoading: false,
    activeQueryError: undefined,
    completedEpisodes: [],
    completedLoading: false,
    completedQueryError: undefined,
  });

  useEffect(() => {
    // Same gate as `powerSyncReplicaSqliteReady` — depend on fields only (exhaustive-deps).
    if (!psBridge.database || !psBridge.localSqliteInitialized) {
      setPsMirror({
        activeEpisode: null,
        activeLoading: false,
        activeQueryError: undefined,
        completedEpisodes: [],
        completedLoading: false,
        completedQueryError: undefined,
      });
    }
  }, [psBridge.database, psBridge.localSqliteInitialized]);

  const [loading, setLoading] = useState(true);
  const [loadingMoreRecent, setLoadingMoreRecent] = useState(false);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [active, setActive] = useState<EpisodeRow | null>(null);
  const [recent, setRecent] = useState<EpisodeRow[]>([]);
  const [hasMoreRecent, setHasMoreRecent] = useState(false);
  /** Grows the completed-episode SQLite `LIMIT` when Manage pages history without Supabase. */
  const [psCompletedFetchLimit, setPsCompletedFetchLimit] =
    useState(RECENT_PAGE_SIZE);
  const [cancelingActiveEpisode, setCancelingActiveEpisode] = useState(false);
  const [deletingEpisodeId, setDeletingEpisodeId] = useState<string | null>(
    null,
  );
  const [mediaByEpisodeId, setMediaByEpisodeId] = useState<
    Record<
      string,
      {
        loading: boolean;
        error: string | null;
        items: Array<{
          key: string;
          signedUrl: string | null;
          mediaType: 'video' | 'photo';
          /** Set when signing fails (permissions, bad path); distinct from expired link retry UX. */
          loadError: string | null;
        }>;
      }
    >
  >({});
  /** Prevents overlapping loads per episode (e.g. double tap before `loading` is committed). */
  const episodeMediaLoadInFlightRef = useRef<Record<string, boolean>>({});

  const psReplicaReadsEnabled = powerSyncOfflineReplicaReadsEnabled(psBridge);

  const activeDisplay = useMemo((): EpisodeRow | null => {
    if (psReplicaReadsEnabled && !psMirror.activeQueryError) {
      if (psMirror.activeLoading) {
        // First mirror snapshot: keep Supabase header until the watched query settles.
        if (!activeError) {
          return active;
        }
        return psMirror.activeEpisode;
      }
      // Local replica is authoritative for active row (e.g. cancel deletes SQLite before upload
      // removes the row server-side; Supabase `getActiveEpisodeForUser` can still return it once).
      return psMirror.activeEpisode;
    }
    if (!activeError) {
      return active;
    }
    if (psReplicaReadsEnabled && psMirror.activeEpisode) {
      return psMirror.activeEpisode;
    }
    return null;
  }, [
    active,
    activeError,
    psMirror.activeEpisode,
    psMirror.activeLoading,
    psMirror.activeQueryError,
    psReplicaReadsEnabled,
  ]);

  const recentDisplay = useMemo((): EpisodeRow[] => {
    if (!recentError) {
      return recent;
    }
    if (psReplicaReadsEnabled && !psMirror.completedQueryError) {
      return psMirror.completedEpisodes;
    }
    return [];
  }, [
    psMirror.completedEpisodes,
    psMirror.completedQueryError,
    psReplicaReadsEnabled,
    recent,
    recentError,
  ]);

  const recentMirrorPaging =
    Boolean(recentError) &&
    psReplicaReadsEnabled &&
    psMirror.completedQueryError == null;

  const hasMoreRecentEffective = useMemo(() => {
    if (recentMirrorPaging) {
      if (psMirror.completedLoading) {
        return false;
      }
      return psMirror.completedEpisodes.length === psCompletedFetchLimit;
    }
    return hasMoreRecent;
  }, [
    hasMoreRecent,
    psCompletedFetchLimit,
    psMirror.completedEpisodes.length,
    psMirror.completedLoading,
    recentMirrorPaging,
  ]);

  const showLoadMoreRecent =
    hasMoreRecentEffective && (!recentError || recentMirrorPaging);

  /**
   * When Supabase list calls fail but this install has a local replica, explain that Manage uses
   * synced SQLite (same rows upload when online again via PowerSync). Omit when the matching
   * watched query also failed so we do not imply the device copy is authoritative.
   */
  const showOfflineReplicaCallout =
    psReplicaReadsEnabled &&
    (activeError != null || recentError != null) &&
    !(activeError != null && psMirror.activeQueryError) &&
    !(recentError != null && psMirror.completedQueryError);

  /** When SQLite reads succeed, soften the Supabase header error in favor of local rows. */
  const suppressActiveServerError =
    Boolean(activeError) &&
    psReplicaReadsEnabled &&
    psMirror.activeQueryError == null;

  const suppressRecentServerError =
    Boolean(recentError) &&
    psReplicaReadsEnabled &&
    psMirror.completedQueryError == null;

  const showActiveReplicaLoadingHint =
    Boolean(activeError) &&
    psReplicaReadsEnabled &&
    psMirror.activeLoading &&
    psMirror.activeEpisode == null;

  const showRecentReplicaLoadingHint =
    Boolean(recentError) &&
    psReplicaReadsEnabled &&
    psMirror.completedLoading &&
    psMirror.completedEpisodes.length === 0;

  const loadInitial = useCallback(
    async (cancel?: { cancelled: boolean }) => {
      const generation = ++loadGenRef.current;
      const stale = () =>
        cancel?.cancelled === true || generation !== loadGenRef.current;

      setLoading(true);
      setActiveError(null);
      setRecentError(null);
      setPsCompletedFetchLimit(RECENT_PAGE_SIZE);

      try {
        const client = getMobileSupabaseClient();
        const {
          data: { session },
        } = await getMobileAuthSessionSafe();
        if (stale()) {
          return;
        }
        const userId = session?.user?.id ?? null;
        if (!userId) {
          setActive(null);
          setRecent([]);
          setHasMoreRecent(false);
          return;
        }

        const [activeRes, recentRes] = await Promise.all([
          getActiveEpisodeForUser(client, userId),
          listCompletedEpisodesForUser(client, userId, {
            limit: RECENT_PAGE_SIZE,
            offset: 0,
            endedAtOrAfter: endedAtOrAfter ?? undefined,
            endedAtOrBefore: endedAtOrBefore ?? undefined,
          }),
        ]);

        if (stale()) {
          return;
        }

        if (!activeRes.ok) {
          setActiveError(activeRes.error.message);
          setActive(null);
        } else {
          setActive(activeRes.data);
        }

        if (!recentRes.ok) {
          setRecentError(recentRes.error.message);
          setRecent([]);
          setHasMoreRecent(false);
        } else {
          setRecent(recentRes.data);
          setHasMoreRecent(recentRes.data.length === RECENT_PAGE_SIZE);
        }
      } catch {
        if (!stale()) {
          const message = 'Unable to load episodes.';
          setActiveError(message);
          setRecentError(message);
          setActive(null);
          setRecent([]);
          setHasMoreRecent(false);
        }
      } finally {
        if (!stale()) {
          setLoading(false);
        }
      }
    },
    [endedAtOrAfter, endedAtOrBefore],
  );

  const loadInitialRef = useRef(loadInitial);
  loadInitialRef.current = loadInitial;
  const { refreshing: syncPullRefreshing, onRefresh: onSyncPullRefresh } =
    usePullToResyncPowerSync(() => loadInitialRef.current());

  const loadMoreRecent = useCallback(async () => {
    if (loadingMoreRecent || !hasMoreRecentEffective) {
      return;
    }
    if (
      recentError &&
      psReplicaReadsEnabled &&
      psMirror.completedQueryError == null
    ) {
      if (psMirror.completedLoading) {
        return;
      }
      setPsCompletedFetchLimit((n) => n + RECENT_PAGE_SIZE);
      return;
    }
    const generation = loadGenRef.current;
    const stale = () => generation !== loadGenRef.current;
    setLoadingMoreRecent(true);
    try {
      const client = getMobileSupabaseClient();
      const {
        data: { session },
      } = await getMobileAuthSessionSafe();
      if (stale()) {
        return;
      }
      const userId = session?.user?.id ?? null;
      if (!userId) {
        setHasMoreRecent(false);
        return;
      }
      const recentRes = await listCompletedEpisodesForUser(client, userId, {
        limit: RECENT_PAGE_SIZE,
        offset: recent.length,
        endedAtOrAfter: endedAtOrAfter ?? undefined,
        endedAtOrBefore: endedAtOrBefore ?? undefined,
      });
      if (stale()) {
        return;
      }
      if (!recentRes.ok) {
        await announce(recentRes.error.message, { politeness: 'assertive' });
        return;
      }
      setRecent((prev) => [...prev, ...recentRes.data]);
      setHasMoreRecent(recentRes.data.length === RECENT_PAGE_SIZE);
    } catch {
      if (!stale()) {
        await announce('Unable to load more episodes.', {
          politeness: 'assertive',
        });
      }
    } finally {
      setLoadingMoreRecent(false);
    }
  }, [
    endedAtOrAfter,
    endedAtOrBefore,
    hasMoreRecentEffective,
    loadingMoreRecent,
    psMirror.completedLoading,
    psMirror.completedQueryError,
    psReplicaReadsEnabled,
    recent.length,
    recentError,
  ]);

  useFocusEffect(
    useCallback(() => {
      const cancel = { cancelled: false };
      void loadInitial(cancel);
      return () => {
        cancel.cancelled = true;
        loadGenRef.current += 1;
      };
    }, [loadInitial]),
  );

  const onResume = (episode: EpisodeRow) => {
    if (episode.post_marker_step_completed_at) {
      navigation.navigate('HealthMarkerPrompt', {
        episodeId: episode.id,
        resume: true,
        hub: true,
      });
      return;
    }
    if (!episode.symptom_preset_id) {
      return;
    }
    navigation.navigate('SymptomPrompt', {
      episodeId: episode.id,
      symptomPresetId: episode.symptom_preset_id,
      resume: true,
    });
  };

  const loadEpisodeMedia = useCallback(async (episodeId: string) => {
    if (episodeMediaLoadInFlightRef.current[episodeId]) {
      return;
    }
    episodeMediaLoadInFlightRef.current[episodeId] = true;
    setMediaByEpisodeId((prev) => ({
      ...prev,
      [episodeId]: {
        loading: true,
        error: null,
        items: prev[episodeId]?.items ?? [],
      },
    }));
    try {
      const client = getMobileSupabaseClient();
      const listed = await listEpisodeMediaForEpisode(client, episodeId);
      if (!listed.ok) {
        setMediaByEpisodeId((prev) => ({
          ...prev,
          [episodeId]: {
            loading: false,
            error: listed.error.message,
            items: [],
          },
        }));
        return;
      }
      const items = await Promise.all(
        listed.data.map(async (row) => {
          const key = row.storage_object_key.trim();
          const { signedUrl, errorMessage } =
            await createEpisodeMediaSignedDisplayUrl(client, key, 120);
          const mediaType: 'video' | 'photo' = isMediaType(row.media_type)
            ? row.media_type
            : 'photo';
          return {
            key,
            signedUrl,
            mediaType,
            loadError: signedUrl ? null : errorMessage,
          };
        }),
      );
      setMediaByEpisodeId((prev) => ({
        ...prev,
        [episodeId]: { loading: false, error: null, items },
      }));
    } catch {
      setMediaByEpisodeId((prev) => ({
        ...prev,
        [episodeId]: {
          loading: false,
          error: 'Unable to load media preview.',
          items: [],
        },
      }));
    } finally {
      episodeMediaLoadInFlightRef.current[episodeId] = false;
    }
  }, []);

  /**
   * When a signed URL loads but the asset fails (expired, 403, network), swap to error UI + retry.
   *
   * @param episodeId - Episode whose media list should be updated.
   * @param storageKey - Storage object key (`item.key`) for the failed asset.
   */
  const onEpisodeMediaDisplayError = useCallback(
    (episodeId: string, storageKey: string) => {
      setMediaByEpisodeId((prev) => {
        const state = prev[episodeId];
        if (!state?.items?.length) {
          return prev;
        }
        let changed = false;
        const items = state.items.map((it) => {
          if (it.key !== storageKey || !it.signedUrl) {
            return it;
          }
          changed = true;
          return {
            ...it,
            signedUrl: null,
            loadError: 'Link expired or unavailable.',
          };
        });
        if (!changed) {
          return prev;
        }
        return { ...prev, [episodeId]: { ...state, items } };
      });
    },
    [],
  );

  const onCancelEpisode = useCallback(() => {
    if (!activeDisplay || cancelingActiveEpisode) {
      return;
    }
    Alert.alert(
      'Cancel this active episode?',
      'Canceling permanently deletes this in-progress episode, its symptom answers, health markers, and media metadata. Food diary entries are kept, but this episode link is removed. This cannot be undone.',
      [
        { text: 'Keep episode', style: 'cancel' },
        {
          text: 'Cancel episode',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setCancelingActiveEpisode(true);
              try {
                const client = getMobileSupabaseClient();
                const result = await cancelActiveEpisodeByIdOfflineFirst(
                  client,
                  powerSyncDbForWrites,
                  activeDisplay.id,
                );
                if (!result.ok) {
                  await announce(result.error.message, {
                    politeness: 'assertive',
                  });
                  return;
                }
                clearSymptomPromptSession(activeDisplay.id);
                if (result.data.didCancel) {
                  await announce(
                    'Episode canceled. Resume is no longer available.',
                    {
                      politeness: 'polite',
                    },
                  );
                } else {
                  await announce('This episode is no longer active.', {
                    politeness: 'polite',
                  });
                }
                await loadInitial();
              } finally {
                setCancelingActiveEpisode(false);
              }
            })();
          },
        },
      ],
    );
  }, [
    activeDisplay,
    cancelingActiveEpisode,
    loadInitial,
    powerSyncDbForWrites,
  ]);

  const onDeleteEpisode = useCallback(
    (episode: EpisodeRow) => {
      if (deletingEpisodeId) {
        return;
      }
      Alert.alert(
        'Delete this episode from history?',
        'Deleting permanently removes this episode, its symptom answers, health markers, and media metadata. Food diary entries are kept, but this episode link is removed. This cannot be undone.',
        [
          { text: 'Keep episode', style: 'cancel' },
          {
            text: 'Delete episode',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                setDeletingEpisodeId(episode.id);
                try {
                  const client = getMobileSupabaseClient();
                  const result = await deleteEpisodeByIdOfflineFirst(
                    client,
                    powerSyncDbForWrites,
                    episode.id,
                  );
                  if (!result.ok) {
                    await announce(result.error.message, {
                      politeness: 'assertive',
                    });
                    return;
                  }
                  if (result.data.didDelete) {
                    await announce('Episode deleted from history.', {
                      politeness: 'polite',
                    });
                  } else {
                    await announce('This episode is no longer available.', {
                      politeness: 'polite',
                    });
                  }
                  await loadInitial();
                } finally {
                  setDeletingEpisodeId(null);
                }
              })();
            },
          },
        ],
      );
    },
    [deletingEpisodeId, loadInitial, powerSyncDbForWrites],
  );

  const body = (
    <>
      {powerSyncReplicaSqliteReady(psBridge) ? (
        <PowerSyncEpisodeReadSubscriptions
          userId={viewerUserId}
          endedAtOrAfter={endedAtOrAfter}
          endedAtOrBefore={endedAtOrBefore}
          completedEpisodesFetchLimit={psCompletedFetchLimit}
          onSnapshots={setPsMirror}
        />
      ) : null}
      <ScrollView
        className="min-h-0 flex-1"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 24, gap: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={syncPullRefreshing}
            onRefresh={onSyncPullRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {variant === 'standalone' ? (
          <>
            <Text
              className={`text-[22px] font-semibold ${nw.textInk}`}
              accessibilityRole="header"
              maxFontSizeMultiplier={2}
            >
              Episodes
            </Text>
            <Text
              className={`text-base ${nw.textMuted}`}
              maxFontSizeMultiplier={2}
            >
              Active and recent episodes. Resume continues the guided symptom
              flow.
            </Text>
          </>
        ) : (
          <Text className={`text-sm ${nw.textMuted}`} maxFontSizeMultiplier={2}>
            Episode records (symptom flow and markers). Standalone health and
            food entries live under the other Manage tabs.
          </Text>
        )}

        {showOfflineReplicaCallout ? (
          <View
            className={`rounded-lg px-3 py-2.5 ${nw.card}`}
            accessibilityRole="text"
            accessibilityLiveRegion="polite"
          >
            <Text
              className={`text-sm leading-snug ${nw.textInk}`}
              maxFontSizeMultiplier={2}
            >
              Showing episodes from data synced on this device. Media previews
              still need a network connection. Episode list, cancel, and delete
              use your local copy and sync to the server when you are back
              online.
            </Text>
          </View>
        ) : null}

        <View>
          <Text
            className={`text-lg font-semibold ${nw.textInk}`}
            accessibilityRole="header"
            maxFontSizeMultiplier={2}
          >
            Active episode
          </Text>
          {loading ? (
            <Text className={`mt-2 text-sm ${nw.textMuted}`}>Loading…</Text>
          ) : null}
          {activeError && !suppressActiveServerError ? (
            <Text
              className={`mt-2 text-sm ${nw.textError}`}
              accessibilityRole="alert"
              maxFontSizeMultiplier={2}
            >
              {activeError}
            </Text>
          ) : null}
          {showActiveReplicaLoadingHint ? (
            <Text
              className={`mt-2 text-sm ${nw.textMuted}`}
              accessibilityLiveRegion="polite"
              maxFontSizeMultiplier={2}
            >
              Loading active episode from this device…
            </Text>
          ) : null}
          {!loading && psMirror.activeQueryError && !psMirror.activeLoading ? (
            <Text
              className={`mt-2 text-sm ${nw.textError}`}
              accessibilityRole="alert"
              maxFontSizeMultiplier={2}
            >
              Could not read the active episode from the copy on this device.{' '}
              {psMirror.activeQueryError.message}
            </Text>
          ) : null}
          {!loading && activeDisplay === null ? (
            <Text className={`mt-2 text-sm ${nw.textMuted}`}>
              No episode in progress.
            </Text>
          ) : null}
          {!loading && activeDisplay !== null ? (
            <View
              className={`mt-3 gap-2 rounded-2xl border-2 border-emerald-600/45 bg-emerald-50 p-4 dark:border-emerald-500/45 dark:bg-emerald-950/50`}
              accessibilityLabel="Active episode"
            >
              <Text
                className="text-xs font-semibold uppercase text-emerald-800 dark:text-emerald-200"
                maxFontSizeMultiplier={2}
              >
                In progress
              </Text>
              <Text
                className={`text-base font-semibold ${nw.textInk}`}
                maxFontSizeMultiplier={2}
              >
                {episodeSummaryLine(activeDisplay)}
              </Text>
              <Text
                className={`text-sm ${nw.textMuted}`}
                maxFontSizeMultiplier={2}
              >
                Started {formatInstant(activeDisplay.started_at)}
              </Text>
              <Text
                className={`text-sm ${nw.textMuted}`}
                maxFontSizeMultiplier={2}
              >
                Ended —
              </Text>
              {activeDisplay.post_marker_step_completed_at ||
              activeDisplay.symptom_preset_id ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Resume this episode"
                  onPress={() => onResume(activeDisplay)}
                  className={`mt-2 min-h-[52px] items-center justify-center rounded-xl bg-emerald-700 px-4 py-3 dark:bg-emerald-600`}
                >
                  <Text className="text-center text-[17px] font-semibold text-white">
                    Resume this episode
                  </Text>
                </Pressable>
              ) : (
                <Text className={`mt-1 text-sm ${nw.textMuted}`}>
                  No symptom preset linked yet. Start or configure an episode
                  from the episode start screen.
                </Text>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel episode"
                accessibilityHint="Permanently removes this in-progress episode"
                accessibilityState={{ disabled: cancelingActiveEpisode }}
                onPress={onCancelEpisode}
                disabled={cancelingActiveEpisode}
                className={`mt-2 min-h-[52px] items-center justify-center rounded-xl border border-red-300 bg-red-50 px-4 py-3 dark:border-red-800/80 dark:bg-red-950/30`}
              >
                <Text
                  className="text-center text-[17px] font-semibold text-red-800 dark:text-red-200"
                  maxFontSizeMultiplier={2}
                >
                  {cancelingActiveEpisode
                    ? 'Canceling episode…'
                    : 'Cancel episode'}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <View>
          <Text
            className={`text-lg font-semibold ${nw.textInk}`}
            accessibilityRole="header"
            maxFontSizeMultiplier={2}
          >
            Recent episodes
          </Text>
          {recentError && !suppressRecentServerError ? (
            <Text
              className={`mt-2 text-sm ${nw.textError}`}
              accessibilityRole="alert"
              maxFontSizeMultiplier={2}
            >
              {recentError}
            </Text>
          ) : null}
          {showRecentReplicaLoadingHint ? (
            <Text
              className={`mt-2 text-sm ${nw.textMuted}`}
              accessibilityLiveRegion="polite"
              maxFontSizeMultiplier={2}
            >
              Loading recent episodes from this device…
            </Text>
          ) : null}
          {!loading &&
          psMirror.completedQueryError &&
          !psMirror.completedLoading ? (
            <Text
              className={`mt-2 text-sm ${nw.textError}`}
              accessibilityRole="alert"
              maxFontSizeMultiplier={2}
            >
              Could not read recent episodes from the copy on this device.{' '}
              {psMirror.completedQueryError.message}
            </Text>
          ) : null}
          {!loading &&
          recentDisplay.length === 0 &&
          (!recentError || suppressRecentServerError) &&
          !showRecentReplicaLoadingHint &&
          !psMirror.completedQueryError ? (
            <Text className={`mt-2 text-sm ${nw.textMuted}`}>
              No ended episodes in your history yet.
            </Text>
          ) : null}
          {!loading && recentDisplay.length > 0 ? (
            <View className="mt-3 gap-3" accessibilityRole="list">
              {recentDisplay.map((ep) => (
                <View
                  key={ep.id}
                  className={`rounded-xl border border-app-border bg-app-surface p-4 dark:border-app-border-dark dark:bg-app-surface-dark`}
                  accessibilityRole="none"
                >
                  <Text
                    className="text-xs font-semibold uppercase text-app-muted"
                    maxFontSizeMultiplier={2}
                  >
                    Ended
                  </Text>
                  <Text
                    className="text-xs text-app-muted"
                    maxFontSizeMultiplier={2}
                    accessibilityLabel="Episode record (not a standalone entry)"
                  >
                    Episode record
                  </Text>
                  <Text
                    className={`mt-1 text-base font-semibold ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    {episodeSummaryLine(ep)}
                  </Text>
                  <Text className={`mt-2 text-sm ${nw.textMuted}`}>
                    Started {formatInstant(ep.started_at)}
                  </Text>
                  <Text className={`text-sm ${nw.textMuted}`}>
                    Ended {ep.ended_at ? formatInstant(ep.ended_at) : '—'}
                  </Text>
                  <Text className={`text-sm ${nw.textMuted}`}>
                    Duration{' '}
                    {formatEpisodeDurationSimple(ep.started_at, ep.ended_at) ??
                      '—'}
                  </Text>
                  <View className="mt-2 rounded-lg border border-app-border px-3 py-3 dark:border-app-border-dark">
                    {(() => {
                      const mediaState = mediaByEpisodeId[ep.id];
                      return (
                        <>
                          <Text
                            className={`text-sm font-semibold ${nw.textInk}`}
                          >
                            Details
                          </Text>
                          <Text className={`mt-1 text-xs ${nw.textMuted}`}>
                            Type: {ep.episode_type}
                          </Text>
                          {ep.episode_label?.trim() ? (
                            <Text className={`mt-0.5 text-xs ${nw.textMuted}`}>
                              Label: {ep.episode_label.trim()}
                            </Text>
                          ) : null}
                          <Text
                            className={`mt-2 text-xs font-semibold ${nw.textInk}`}
                          >
                            Media
                          </Text>
                          {!mediaState ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="Load episode media"
                              onPress={() => void loadEpisodeMedia(ep.id)}
                              className="mt-2 min-h-[40px] self-start rounded-lg border border-app-border px-3 py-2 dark:border-app-border-dark"
                            >
                              <Text
                                className={`text-xs font-semibold ${nw.textPrimary}`}
                              >
                                Load media
                              </Text>
                            </Pressable>
                          ) : null}
                          {mediaState?.loading ? (
                            <View className="mt-2 flex-row items-center gap-2">
                              <ActivityIndicator />
                              <Text className={`text-xs ${nw.textMuted}`}>
                                Loading media…
                              </Text>
                            </View>
                          ) : null}
                          {mediaState?.error ? (
                            <View className="mt-2">
                              <Text className={`text-xs ${nw.textError}`}>
                                {mediaState.error}
                              </Text>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Retry loading media"
                                accessibilityState={{
                                  disabled: Boolean(mediaState?.loading),
                                }}
                                disabled={Boolean(mediaState?.loading)}
                                onPress={() => void loadEpisodeMedia(ep.id)}
                                className={`mt-2 min-h-[40px] self-start rounded-lg border border-app-border px-3 py-2 dark:border-app-border-dark ${mediaState?.loading ? 'opacity-50' : ''}`}
                              >
                                <Text
                                  className={`text-xs font-semibold ${nw.textPrimary}`}
                                >
                                  Retry
                                </Text>
                              </Pressable>
                            </View>
                          ) : null}
                          {!mediaState?.loading &&
                          !mediaState?.error &&
                          mediaState &&
                          mediaState.items.length === 0 ? (
                            <Text className={`mt-2 text-xs ${nw.textMuted}`}>
                              No photo or video for this episode.
                            </Text>
                          ) : null}
                          {mediaState?.items.length ? (
                            <View className="mt-2 gap-2">
                              {mediaState.items.map((item) => (
                                <View
                                  key={item.key}
                                  className="overflow-hidden rounded-lg border border-app-border/80 bg-black/5 dark:border-app-border-dark/80 dark:bg-black/25"
                                  style={{ minHeight: 180 }}
                                >
                                  {item.signedUrl ? (
                                    item.mediaType === 'video' ? (
                                      <EpisodeMediaVideo uri={item.signedUrl} />
                                    ) : (
                                      <Image
                                        source={{ uri: item.signedUrl }}
                                        accessibilityLabel="Episode media"
                                        accessibilityIgnoresInvertColors
                                        style={{ width: '100%', height: 220 }}
                                        resizeMode="contain"
                                        onError={() =>
                                          onEpisodeMediaDisplayError(
                                            ep.id,
                                            item.key,
                                          )
                                        }
                                      />
                                    )
                                  ) : (
                                    <Text className="p-3 text-xs text-red-700 dark:text-red-300">
                                      {item.loadError ??
                                        'Link expired or unavailable.'}
                                    </Text>
                                  )}
                                </View>
                              ))}
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Refresh media links"
                                accessibilityState={{
                                  disabled: Boolean(mediaState?.loading),
                                }}
                                disabled={Boolean(mediaState?.loading)}
                                onPress={() => void loadEpisodeMedia(ep.id)}
                                className={`min-h-[40px] self-start rounded-lg border border-app-border px-3 py-2 dark:border-app-border-dark ${mediaState?.loading ? 'opacity-50' : ''}`}
                              >
                                <Text
                                  className={`text-xs font-semibold ${nw.textPrimary}`}
                                >
                                  Refresh media links
                                </Text>
                              </Pressable>
                            </View>
                          ) : null}
                        </>
                      );
                    })()}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${episodeSummaryLine(ep)} episode`}
                    accessibilityHint="Permanently removes this episode from history"
                    accessibilityState={{
                      disabled: deletingEpisodeId === ep.id,
                    }}
                    onPress={() => onDeleteEpisode(ep)}
                    disabled={deletingEpisodeId === ep.id}
                    className="mt-2 items-start justify-center rounded-lg px-1 py-2"
                  >
                    <Text className="text-sm font-medium text-red-700 dark:text-red-300">
                      {deletingEpisodeId === ep.id
                        ? 'Deleting episode…'
                        : 'Delete episode'}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          {showLoadMoreRecent ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Load more episodes"
              accessibilityState={{ disabled: loadingMoreRecent }}
              onPress={() => void loadMoreRecent()}
              disabled={loadingMoreRecent}
              className={`mt-4 min-h-[48px] items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 py-3 dark:border-app-border-dark dark:bg-app-surface-dark ${loadingMoreRecent ? 'opacity-60' : ''}`}
            >
              <Text className={`text-base font-semibold ${nw.textInk}`}>
                {loadingMoreRecent ? 'Loading…' : 'Load more episodes'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </>
  );

  if (variant === 'embedded') {
    return <View className="min-h-0 flex-1">{body}</View>;
  }

  return <ScreenShell contentAlign="stretch">{body}</ScreenShell>;
}

function EpisodeMediaVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  return (
    <VideoView
      player={player}
      accessibilityLabel="Episode media video"
      nativeControls
      contentFit="contain"
      style={{ width: '100%', height: 220 }}
    />
  );
}
