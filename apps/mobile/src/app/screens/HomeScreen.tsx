import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { EpisodeRow } from '@abstrack/types';
import {
  getActiveEpisodeForUser,
  listCompletedEpisodesForUser,
} from '@abstrack/supabase';
import { useMobilePhiSubjectUserContext } from '../../lib/auth/use-mobile-phi-subject-user-context';
import { fetchMobileDeviceIsConnected } from '../../lib/network/mobile-device-netinfo';
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
import { AppNavigationShell } from '../components/AppNavigationShell';
import { HomeDashboardActionCard } from '../components/HomeDashboardActionCard';
import { HomeRecentEpisodesCard } from '../components/HomeRecentEpisodesCard';
import {
  EpisodeStartHomeCta,
  episodeRowToActiveHomeSummary,
  type ActiveEpisodeHomeSummary,
} from '../components/episode-flow/EpisodeStartHomeCta';
import { userFacingSyncHealthBridgeOrClientError } from '../components/sync-health-footer-user-messages';
import { useAppTheme } from '../theme/AppThemeContext';
import { nw } from '../theme/app-nativewind-classes';

const HOME_RECENT_EPISODES_LIMIT = 3;

const EMPTY_POWER_SYNC_EPISODE_SNAP: PowerSyncEpisodeReadSnapshots = {
  activeEpisode: null,
  activeLoading: false,
  activeQueryError: undefined,
  completedEpisodes: [],
  completedLoading: false,
  completedQueryError: undefined,
};

type HomeScreenProps = {
  headerAction?: React.ReactNode;
  onGoToManageEpisodes: () => void;
  onGoToFoodDiary: () => void;
  onGoToStandaloneHealthMarkers: () => void;
  onStartEpisode: () => void;
  onResumeEpisode: (episode: ActiveEpisodeHomeSummary) => void;
};

/**
 * Mobile dashboard surface for the signed-in user: episode logging, standalone logging shortcuts,
 * and a short recent-episodes preview.
 *
 * @param props - Header action plus primary Home navigation callbacks.
 * @returns Home dashboard content.
 */
export function HomeScreen({
  headerAction,
  onGoToManageEpisodes,
  onGoToFoodDiary,
  onGoToStandaloneHealthMarkers,
  onStartEpisode,
  onResumeEpisode,
}: HomeScreenProps) {
  const { colors } = useAppTheme();
  /** When `EXPO_PUBLIC_POWERSYNC_URL` is unset only: online Supabase resume row (see README). */
  const [networkResumeEpisode, setNetworkResumeEpisode] =
    useState<ActiveEpisodeHomeSummary | null>(null);
  const [networkResumeLoading, setNetworkResumeLoading] = useState(false);
  /**
   * True when the last network-resume attempt bailed before calling Supabase because NetInfo
   * reported explicit offline. While PowerSync is configured but the replica is not mirror-ready,
   * we must not treat a null resume row as authoritative (empty replica + no fetch).
   */
  const [networkResumeSkippedOffline, setNetworkResumeSkippedOffline] =
    useState(false);
  const [recentEpisodes, setRecentEpisodes] = useState<EpisodeRow[]>([]);
  const [recentEpisodesLoading, setRecentEpisodesLoading] = useState(false);
  const [recentEpisodesError, setRecentEpisodesError] = useState<string | null>(
    null,
  );
  const [recentEpisodesSkippedOffline, setRecentEpisodesSkippedOffline] =
    useState(false);

  const {
    authUserId,
    phiSubjectUserId,
    loading: phiSubjectLoading,
    errorMessage: phiSubjectError,
    refresh: refreshPhiSubject,
  } = useMobilePhiSubjectUserContext();
  const psBridge = usePowerSyncBridgeState();
  const replicaMirrorHomeReads = useMemo(
    () => powerSyncOfflineReplicaReadsEnabled(psBridge),
    [psBridge],
  );
  const [psEpisodeSnap, setPsEpisodeSnap] =
    useState<PowerSyncEpisodeReadSnapshots>(EMPTY_POWER_SYNC_EPISODE_SNAP);

  useEffect(() => {
    if (!psBridge.database || !psBridge.localSqliteInitialized) {
      setPsEpisodeSnap(EMPTY_POWER_SYNC_EPISODE_SNAP);
    }
  }, [psBridge.database, psBridge.localSqliteInitialized]);

  useEffect(() => {
    setNetworkResumeEpisode(null);
    setNetworkResumeLoading(false);
    setNetworkResumeSkippedOffline(false);
    setRecentEpisodes([]);
    setRecentEpisodesLoading(false);
    setRecentEpisodesError(null);
    setRecentEpisodesSkippedOffline(false);
  }, [phiSubjectUserId]);

  useEffect(() => {
    if (replicaMirrorHomeReads) {
      setNetworkResumeEpisode(null);
      setNetworkResumeLoading(false);
      setNetworkResumeSkippedOffline(false);
      setRecentEpisodes([]);
      setRecentEpisodesLoading(false);
      setRecentEpisodesError(null);
      setRecentEpisodesSkippedOffline(false);
    }
  }, [replicaMirrorHomeReads]);

  const loadNetworkResumeEpisode = useCallback(
    async (
      cancel?: { cancelled: boolean },
      options?: { bypassReplicaMirrorGate?: boolean },
    ) => {
      const stale = () => cancel?.cancelled === true;
      if (!phiSubjectUserId) {
        if (!stale()) {
          setNetworkResumeLoading(false);
          setNetworkResumeSkippedOffline(false);
        }
        return;
      }
      if (replicaMirrorHomeReads && !options?.bypassReplicaMirrorGate) {
        if (!stale()) {
          setNetworkResumeLoading(false);
          setNetworkResumeSkippedOffline(false);
        }
        return;
      }
      const connected = await fetchMobileDeviceIsConnected();
      if (connected === false) {
        if (!stale()) {
          setNetworkResumeSkippedOffline(true);
          setNetworkResumeLoading(false);
        }
        return;
      }
      if (!stale()) {
        setNetworkResumeSkippedOffline(false);
      }
      setNetworkResumeLoading(true);
      try {
        const mobileSupabase = getMobileSupabaseClient();
        const {
          data: { session },
          error: sessionError,
        } = await getMobileAuthSessionSafe();
        if (stale()) {
          return;
        }
        if (sessionError || !session?.user?.id) {
          setNetworkResumeEpisode(null);
          return;
        }
        const result = await getActiveEpisodeForUser(
          mobileSupabase,
          phiSubjectUserId,
        );
        if (stale()) {
          return;
        }
        if (!result.ok || !result.data) {
          setNetworkResumeEpisode(null);
          return;
        }
        setNetworkResumeEpisode(
          episodeRowToActiveHomeSummary(result.data) ?? null,
        );
      } catch {
        if (!stale()) {
          setNetworkResumeEpisode(null);
        }
      } finally {
        if (!stale()) {
          setNetworkResumeLoading(false);
        }
      }
    },
    [phiSubjectUserId, replicaMirrorHomeReads],
  );

  const loadRecentEpisodes = useCallback(
    async (cancel?: { cancelled: boolean }) => {
      const stale = () => cancel?.cancelled === true;
      if (!phiSubjectUserId) {
        if (!stale()) {
          setRecentEpisodes([]);
          setRecentEpisodesLoading(false);
          setRecentEpisodesError(null);
          setRecentEpisodesSkippedOffline(false);
        }
        return;
      }
      if (replicaMirrorHomeReads) {
        if (!stale()) {
          setRecentEpisodes([]);
          setRecentEpisodesLoading(false);
          setRecentEpisodesError(null);
          setRecentEpisodesSkippedOffline(false);
        }
        return;
      }

      const connected = await fetchMobileDeviceIsConnected();
      if (connected === false) {
        if (!stale()) {
          setRecentEpisodes([]);
          setRecentEpisodesLoading(false);
          setRecentEpisodesError(null);
          setRecentEpisodesSkippedOffline(true);
        }
        return;
      }

      if (!stale()) {
        setRecentEpisodesLoading(true);
        setRecentEpisodesError(null);
        setRecentEpisodesSkippedOffline(false);
      }

      try {
        const {
          data: { session },
          error: sessionError,
        } = await getMobileAuthSessionSafe();
        if (stale()) {
          return;
        }
        if (sessionError || !session?.user?.id) {
          setRecentEpisodes([]);
          return;
        }

        const mobileSupabase = getMobileSupabaseClient();
        const result = await listCompletedEpisodesForUser(
          mobileSupabase,
          phiSubjectUserId,
          {
            limit: HOME_RECENT_EPISODES_LIMIT,
            offset: 0,
          },
        );
        if (stale()) {
          return;
        }
        if (!result.ok) {
          setRecentEpisodes([]);
          setRecentEpisodesError(result.error.message);
          return;
        }
        setRecentEpisodes(result.data);
        setRecentEpisodesError(null);
      } catch {
        if (!stale()) {
          setRecentEpisodes([]);
          setRecentEpisodesError('Unable to load recent episodes.');
        }
      } finally {
        if (!stale()) {
          setRecentEpisodesLoading(false);
        }
      }
    },
    [phiSubjectUserId, replicaMirrorHomeReads],
  );

  /** When the watched SQLite query fails, fetch Supabase resume as a fallback (same user, online). */
  useEffect(() => {
    if (
      !phiSubjectUserId ||
      !replicaMirrorHomeReads ||
      !psEpisodeSnap.activeQueryError
    ) {
      return;
    }
    const cancel = { cancelled: false };
    void loadNetworkResumeEpisode(cancel, { bypassReplicaMirrorGate: true });
    return () => {
      cancel.cancelled = true;
    };
  }, [
    phiSubjectUserId,
    replicaMirrorHomeReads,
    psEpisodeSnap.activeQueryError,
    loadNetworkResumeEpisode,
  ]);

  /** Drop stale online fallback once local reads work again. */
  useEffect(() => {
    if (!replicaMirrorHomeReads || psEpisodeSnap.activeQueryError) {
      return;
    }
    setNetworkResumeEpisode(null);
    setNetworkResumeLoading(false);
    setNetworkResumeSkippedOffline(false);
  }, [replicaMirrorHomeReads, psEpisodeSnap.activeQueryError]);

  const loadNetworkResumeEpisodeRef = useRef(loadNetworkResumeEpisode);
  loadNetworkResumeEpisodeRef.current = loadNetworkResumeEpisode;
  const loadRecentEpisodesRef = useRef(loadRecentEpisodes);
  loadRecentEpisodesRef.current = loadRecentEpisodes;
  const authStateLoadCancelRef = useRef<{ cancelled: boolean } | null>(null);
  const psActiveEpisodeQueryErrorRef = useRef<Error | undefined>(undefined);
  psActiveEpisodeQueryErrorRef.current = psEpisodeSnap.activeQueryError;

  const { refreshing: syncPullRefreshing, onRefresh: onSyncPullRefresh } =
    usePullToResyncPowerSync(() => {
      void loadNetworkResumeEpisodeRef.current(undefined, {
        bypassReplicaMirrorGate: Boolean(psActiveEpisodeQueryErrorRef.current),
      });
      void loadRecentEpisodesRef.current();
      refreshPhiSubject();
    });

  useFocusEffect(
    useCallback(() => {
      const cancel = { cancelled: false };
      const bypass =
        replicaMirrorHomeReads && Boolean(psEpisodeSnap.activeQueryError);
      if (!replicaMirrorHomeReads || bypass) {
        void loadNetworkResumeEpisode(
          cancel,
          bypass ? { bypassReplicaMirrorGate: true } : undefined,
        );
      }
      void loadRecentEpisodes(cancel);
      return () => {
        cancel.cancelled = true;
      };
    }, [
      loadNetworkResumeEpisode,
      loadRecentEpisodes,
      replicaMirrorHomeReads,
      psEpisodeSnap.activeQueryError,
    ]),
  );

  useEffect(() => {
    if (replicaMirrorHomeReads) {
      return;
    }
    const cancel = { cancelled: false };
    authStateLoadCancelRef.current = cancel;
    const supabase = getMobileSupabaseClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        void loadNetworkResumeEpisode(cancel);
        void loadRecentEpisodes(cancel);
      }
    });
    return () => {
      cancel.cancelled = true;
      if (authStateLoadCancelRef.current === cancel) {
        authStateLoadCancelRef.current = null;
      }
      subscription.unsubscribe();
    };
  }, [loadNetworkResumeEpisode, loadRecentEpisodes, replicaMirrorHomeReads]);

  /**
   * Episode CTA loading: with PowerSync configured, wait on SQLite **only** while init/connect may
   * still succeed (`syncConnecting`, or an open DB handle with no terminal {@link PowerSyncBridgeState.syncError}).
   * If `init`/`connect` fails (SQLCipher, schema, etc.), do **not** spin forever — the same online
   * resume path as when the replica is not mirror-ready drives loading so {@link loadNetworkResumeEpisode}
   * can surface Supabase. When the replica is mirror-ready, keep loading while first sync is still
   * connecting without completion. If NetInfo is explicitly offline before that fetch, stay in
   * loading so an empty local DB is not mistaken for “no active episode.”
   *
   * When mirror reads are enabled but the active-episode watched query errors, keep loading while
   * the online resume attempt is running **or** explicitly skipped for offline
   * (`networkResumeSkippedOffline`). In that skipped-offline state we still have no authoritative
   * answer for whether an active episode exists, so Home must not drop into the start-episode CTA.
   *
   * When mirror reads are **not** trusted yet (no first sync) but {@link powerSyncReplicaSqliteReady}
   * is already true, do **not** keep spinning on skipped-offline alone — offline writes (episode
   * start) are allowed on initialized SQLite; blocking the CTA would trap airplane-mode users after
   * init without helping resume accuracy.
   */
  const activeEpisodeLoading = useMemo(() => {
    if (!authUserId) {
      return false;
    }
    if (phiSubjectError) {
      return false;
    }
    if (phiSubjectLoading || !phiSubjectUserId) {
      return true;
    }
    if (psBridge.powerSyncUrlConfigured) {
      const maybeStillOpeningSqlite =
        !psBridge.localSqliteInitialized &&
        (psBridge.syncConnecting ||
          (psBridge.database != null && psBridge.syncError == null));
      if (maybeStillOpeningSqlite) {
        return true;
      }
      if (replicaMirrorHomeReads) {
        if (psEpisodeSnap.activeQueryError) {
          return networkResumeLoading || networkResumeSkippedOffline;
        }
        return !psBridge.firstSyncCompleted && psBridge.syncConnecting;
      }
      // Same as {@link powerSyncReplicaSqliteReady}; inline so deps stay primitive bridge fields.
      const replicaSqliteReady = Boolean(
        psBridge.database && psBridge.localSqliteInitialized,
      );
      return (
        networkResumeLoading ||
        (!replicaSqliteReady && networkResumeSkippedOffline)
      );
    }
    return networkResumeLoading;
  }, [
    authUserId,
    phiSubjectUserId,
    phiSubjectLoading,
    phiSubjectError,
    psBridge.database,
    psBridge.powerSyncUrlConfigured,
    psBridge.firstSyncCompleted,
    psBridge.localSqliteInitialized,
    psBridge.syncConnecting,
    psBridge.syncError,
    replicaMirrorHomeReads,
    psEpisodeSnap.activeQueryError,
    networkResumeLoading,
    networkResumeSkippedOffline,
  ]);

  const homeActiveEpisode = useMemo((): ActiveEpisodeHomeSummary | null => {
    if (!phiSubjectUserId || phiSubjectError) {
      return null;
    }
    if (replicaMirrorHomeReads) {
      if (psEpisodeSnap.activeQueryError) {
        return networkResumeEpisode;
      }
      const row = psEpisodeSnap.activeEpisode;
      if (!row) {
        return null;
      }
      return episodeRowToActiveHomeSummary(row);
    }
    if (
      powerSyncReplicaSqliteReady(psBridge) &&
      !psEpisodeSnap.activeQueryError &&
      networkResumeEpisode == null &&
      psEpisodeSnap.activeEpisode != null
    ) {
      return episodeRowToActiveHomeSummary(psEpisodeSnap.activeEpisode);
    }
    return networkResumeEpisode;
  }, [
    phiSubjectUserId,
    phiSubjectError,
    replicaMirrorHomeReads,
    psEpisodeSnap.activeEpisode,
    psEpisodeSnap.activeQueryError,
    networkResumeEpisode,
    psBridge,
  ]);

  const activeEpisodeQueryError = useMemo(() => {
    if (!replicaMirrorHomeReads || !psEpisodeSnap.activeQueryError) {
      return null;
    }
    if (activeEpisodeLoading || homeActiveEpisode) {
      return null;
    }
    return `Could not read episode status from the copy stored on this device. ${userFacingSyncHealthBridgeOrClientError(
      psEpisodeSnap.activeQueryError,
    )}`;
  }, [
    replicaMirrorHomeReads,
    psEpisodeSnap.activeQueryError,
    activeEpisodeLoading,
    homeActiveEpisode,
  ]);

  const recentEpisodesFromDevice = useMemo(() => {
    return psEpisodeSnap.completedEpisodes.slice(0, HOME_RECENT_EPISODES_LIMIT);
  }, [psEpisodeSnap.completedEpisodes]);

  const showRecentDeviceFallback =
    !replicaMirrorHomeReads &&
    (recentEpisodesError != null || recentEpisodesSkippedOffline) &&
    !psEpisodeSnap.completedQueryError &&
    recentEpisodesFromDevice.length > 0;

  const recentEpisodesDisplay = showRecentDeviceFallback
    ? recentEpisodesFromDevice
    : replicaMirrorHomeReads
      ? recentEpisodesFromDevice
      : recentEpisodes;

  const recentEpisodesCardLoading = replicaMirrorHomeReads
    ? psEpisodeSnap.completedLoading
    : recentEpisodesLoading;

  const recentEpisodesMessage = useMemo(() => {
    if (replicaMirrorHomeReads) {
      if (
        psEpisodeSnap.completedQueryError &&
        !psEpisodeSnap.completedLoading &&
        recentEpisodesDisplay.length === 0
      ) {
        return `Could not read recent episodes from this device. ${psEpisodeSnap.completedQueryError.message}`;
      }
      return null;
    }
    if (showRecentDeviceFallback) {
      return recentEpisodesSkippedOffline
        ? 'Showing recent episodes saved on this device while you are offline.'
        : 'Showing recent episodes saved on this device.';
    }
    if (recentEpisodesSkippedOffline) {
      return 'Connect to load recent episodes.';
    }
    return recentEpisodesError;
  }, [
    psEpisodeSnap.completedLoading,
    psEpisodeSnap.completedQueryError,
    recentEpisodesDisplay.length,
    recentEpisodesError,
    recentEpisodesSkippedOffline,
    replicaMirrorHomeReads,
    showRecentDeviceFallback,
  ]);

  return (
    <AppNavigationShell title="Home" headerAction={headerAction}>
      {powerSyncReplicaSqliteReady(psBridge) ? (
        <PowerSyncEpisodeReadSubscriptions
          userId={phiSubjectError ? null : phiSubjectUserId}
          completedEpisodesFetchLimit={HOME_RECENT_EPISODES_LIMIT}
          onSnapshots={setPsEpisodeSnap}
        />
      ) : null}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          flexGrow: 1,
          padding: 16,
          paddingBottom: 24,
        }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={syncPullRefreshing}
            onRefresh={onSyncPullRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {phiSubjectError ? (
          <View
            className={`mb-4 rounded-xl border border-app-border bg-app-surface p-4 dark:border-app-border-dark dark:bg-app-surface-dark`}
            accessibilityRole="alert"
          >
            <Text className={`text-base font-semibold ${nw.textInk}`}>
              Caretaker access
            </Text>
            <Text className={`mt-2 text-sm ${nw.textMuted}`}>
              {phiSubjectError}
            </Text>
          </View>
        ) : null}

        <EpisodeStartHomeCta
          onStartEpisode={onStartEpisode}
          onResumeEpisode={onResumeEpisode}
          activeEpisode={homeActiveEpisode}
          activeEpisodeLoading={activeEpisodeLoading}
          activeEpisodeQueryError={activeEpisodeQueryError}
        />

        <HomeDashboardActionCard
          heading="Health markers"
          description="Log vitals and wellness markers outside an episode using your saved presets."
          ctaLabel="Log health markers"
          ctaAccessibilityLabel="Log health markers without an episode"
          onPress={onGoToStandaloneHealthMarkers}
        />

        <HomeDashboardActionCard
          heading="Food diary"
          description="Record meals and notes on their own, or link them later to an episode."
          ctaLabel="Add a food diary entry"
          ctaAccessibilityLabel="Add a food diary entry"
          onPress={onGoToFoodDiary}
        />

        <HomeRecentEpisodesCard
          episodes={recentEpisodesDisplay}
          loading={recentEpisodesCardLoading}
          message={recentEpisodesMessage}
          onViewAllEpisodes={onGoToManageEpisodes}
        />
      </ScrollView>
    </AppNavigationShell>
  );
}
