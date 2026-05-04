import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { EpisodeRow } from '@abstrack/types';
import {
  getActiveEpisodeForUser,
  healthCheckProfilesLimit1,
  signOut,
} from '@abstrack/supabase';
import { useMobileAuthUserId } from '../../lib/auth/use-mobile-auth-user-id';
import { PowerSyncActiveEpisodeSubscription } from '../../lib/powersync/PowerSyncActiveEpisodeSubscription';
import {
  powerSyncOfflineReplicaReadsEnabled,
  powerSyncReplicaSqliteReady,
  usePowerSyncBridgeState,
} from '../../lib/powersync/PowerSyncSessionBridge';
import { usePullToResyncPowerSync } from '../../lib/powersync/use-pull-to-resync-powersync';
import { fetchMobileDeviceIsConnected } from '../../lib/network/mobile-device-netinfo';
import {
  getMobileAuthSessionSafe,
  getMobileSupabaseClient,
} from '../../lib/supabase-wiring';
import { mapAuthError } from '../auth-helpers';
import {
  EpisodeStartHomeCta,
  episodeRowToActiveHomeSummary,
  type ActiveEpisodeHomeSummary,
} from '../components/episode-flow/EpisodeStartHomeCta';
import { AppNavigationShell } from '../components/AppNavigationShell';
import { useAppTheme } from '../theme/AppThemeContext';
import { nw } from '../theme/app-nativewind-classes';

interface HealthCheckResult {
  success: boolean;
  message: string;
  error?: string;
}

type HomeScreenProps = {
  onGoToSettings: () => void;
  onGoToFoodDiary: () => void;
  onGoToStandaloneHealthMarkers: () => void;
  onStartEpisode: () => void;
  onResumeEpisode: (episode: ActiveEpisodeHomeSummary) => void;
};

export function HomeScreen({
  onGoToSettings,
  onGoToFoodDiary,
  onGoToStandaloneHealthMarkers,
  onStartEpisode,
  onResumeEpisode,
}: HomeScreenProps) {
  const { colors } = useAppTheme();
  const isTestEnv =
    typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
  const showHealthCheck = __DEV__ && !isTestEnv;
  const isMountedRef = useRef(true);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [healthCheck, setHealthCheck] = useState<HealthCheckResult | null>(
    null,
  );
  /** When `EXPO_PUBLIC_POWERSYNC_URL` is unset only: online Supabase resume row (see README). */
  const [networkResumeEpisode, setNetworkResumeEpisode] =
    useState<ActiveEpisodeHomeSummary | null>(null);
  const [networkResumeLoading, setNetworkResumeLoading] = useState(false);

  const userId = useMobileAuthUserId();
  const psBridge = usePowerSyncBridgeState();
  const [psEpisodeSnap, setPsEpisodeSnap] = useState<{
    episode: EpisodeRow | null;
    isLoading: boolean;
  }>({ episode: null, isLoading: false });

  useEffect(() => {
    if (!psBridge.database) {
      setPsEpisodeSnap({ episode: null, isLoading: false });
    }
  }, [psBridge.database]);

  useEffect(() => {
    if (!userId) {
      setNetworkResumeEpisode(null);
      setNetworkResumeLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (psBridge.powerSyncUrlConfigured) {
      setNetworkResumeEpisode(null);
      setNetworkResumeLoading(false);
    }
  }, [psBridge.powerSyncUrlConfigured]);

  const loadNetworkResumeEpisode = useCallback(
    async (cancel?: { cancelled: boolean }) => {
      const stale = () => cancel?.cancelled === true;
      if (!userId || psBridge.powerSyncUrlConfigured) {
        if (!stale()) {
          setNetworkResumeLoading(false);
        }
        return;
      }
      const connected = await fetchMobileDeviceIsConnected();
      if (connected === false) {
        if (!stale()) {
          setNetworkResumeLoading(false);
        }
        return;
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
          session.user.id,
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
    [userId, psBridge.powerSyncUrlConfigured],
  );

  const loadNetworkResumeEpisodeRef = useRef(loadNetworkResumeEpisode);
  loadNetworkResumeEpisodeRef.current = loadNetworkResumeEpisode;
  const { refreshing: syncPullRefreshing, onRefresh: onSyncPullRefresh } =
    usePullToResyncPowerSync(() => loadNetworkResumeEpisodeRef.current());

  useFocusEffect(
    useCallback(() => {
      if (psBridge.powerSyncUrlConfigured || !userId) {
        return;
      }
      const cancel = { cancelled: false };
      void loadNetworkResumeEpisode(cancel);
      return () => {
        cancel.cancelled = true;
      };
    }, [loadNetworkResumeEpisode, psBridge.powerSyncUrlConfigured, userId]),
  );

  useEffect(() => {
    if (psBridge.powerSyncUrlConfigured) {
      return;
    }
    const supabase = getMobileSupabaseClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        void loadNetworkResumeEpisode();
      }
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [loadNetworkResumeEpisode, psBridge.powerSyncUrlConfigured]);

  /**
   * Episode CTA loading: with PowerSync configured, until local SQLite `init` completes **and**
   * the first sync attempt has finished (`syncConnecting` false) or `firstSyncCompleted` is
   * true — otherwise the replica can still be empty right after `init()` while the server already
   * has an active episode (fresh install / after `disconnectAndClear`). Without PowerSync URL,
   * while the optional online resume fetch runs.
   */
  const activeEpisodeLoading = useMemo(() => {
    if (!userId) {
      return false;
    }
    if (psBridge.powerSyncUrlConfigured) {
      if (!psBridge.localSqliteInitialized) {
        return true;
      }
      return !psBridge.firstSyncCompleted && psBridge.syncConnecting;
    }
    return networkResumeLoading;
  }, [
    userId,
    psBridge.powerSyncUrlConfigured,
    psBridge.firstSyncCompleted,
    psBridge.localSqliteInitialized,
    psBridge.syncConnecting,
    networkResumeLoading,
  ]);

  const homeActiveEpisode = useMemo((): ActiveEpisodeHomeSummary | null => {
    if (!userId) {
      return null;
    }
    if (powerSyncOfflineReplicaReadsEnabled(psBridge)) {
      const row = psEpisodeSnap.episode;
      if (!row) {
        return null;
      }
      return episodeRowToActiveHomeSummary(row);
    }
    if (psBridge.powerSyncUrlConfigured) {
      return null;
    }
    return networkResumeEpisode;
  }, [userId, psBridge, psEpisodeSnap.episode, networkResumeEpisode]);

  useEffect(() => {
    isMountedRef.current = true;

    if (!showHealthCheck) {
      return () => {
        isMountedRef.current = false;
      };
    }

    const runHealthCheck = async () => {
      try {
        const mobileSupabase = getMobileSupabaseClient();
        const {
          data: { session },
          error: sessionError,
        } = await mobileSupabase.auth.getSession();

        if (sessionError || !session?.user) {
          if (isMountedRef.current) {
            setHealthCheck({
              success: false,
              message: 'Health check failed',
              error: sessionError?.message ?? 'No authenticated user found',
            });
          }
          return;
        }

        const result = await healthCheckProfilesLimit1(mobileSupabase);

        if (result.error) {
          if (isMountedRef.current) {
            setHealthCheck({
              success: false,
              message: 'Health check failed',
              error: result.error.message,
            });
          }
        } else {
          if (isMountedRef.current) {
            setHealthCheck({
              success: true,
              message:
                'Health check passed: authenticated user found and profiles query executed without API error (empty rows may still indicate no profile or restrictive RLS).',
            });
          }
        }
      } catch (err) {
        // getSession may still attempt a token refresh offline; suppress network errors silently.
        const message = err instanceof Error ? err.message : 'Unknown error';
        const isNetworkError =
          message.includes('Network request failed') ||
          message.includes('Failed to fetch');
        if (isMountedRef.current && !isNetworkError) {
          setHealthCheck({
            success: false,
            message: 'Health check error',
            error: message,
          });
        }
      }
    };

    void runHealthCheck();

    return () => {
      isMountedRef.current = false;
    };
  }, [showHealthCheck]);

  const handleSignOut = async () => {
    const mobileSupabase = getMobileSupabaseClient();
    setSignOutBusy(true);
    setSignOutError(null);

    try {
      const { error } = await signOut(mobileSupabase);

      if (error) {
        setSignOutError(mapAuthError(error.message));
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unexpected authentication error';
      setSignOutError(mapAuthError(message));
    } finally {
      setSignOutBusy(false);
    }
  };

  return (
    <AppNavigationShell title="Home">
      {powerSyncReplicaSqliteReady(psBridge) ? (
        <PowerSyncActiveEpisodeSubscription
          userId={userId}
          onChange={setPsEpisodeSnap}
        />
      ) : null}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          flexGrow: 1,
          padding: 16,
          paddingBottom: 24,
          justifyContent: 'flex-start',
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
        <EpisodeStartHomeCta
          onStartEpisode={onStartEpisode}
          onResumeEpisode={onResumeEpisode}
          activeEpisode={homeActiveEpisode}
          activeEpisodeLoading={activeEpisodeLoading}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add food diary entry"
          onPress={onGoToFoodDiary}
          className={`mb-1 min-h-[48px] justify-center rounded-xl border border-app-border bg-app-surface px-4 py-3 dark:border-app-border-dark dark:bg-app-surface-dark`}
        >
          <Text
            className={`text-center text-base font-semibold ${nw.textPrimary}`}
            maxFontSizeMultiplier={2}
          >
            Food diary
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Log health markers without an episode"
          onPress={onGoToStandaloneHealthMarkers}
          className={`mb-1 min-h-[48px] justify-center rounded-xl border border-app-border bg-app-surface px-4 py-3 dark:border-app-border-dark dark:bg-app-surface-dark`}
        >
          <Text
            className={`text-center text-base font-semibold ${nw.textPrimary}`}
            maxFontSizeMultiplier={2}
          >
            Health markers
          </Text>
        </Pressable>

        <View className={`gap-3 rounded-xl p-4 ${nw.card} ${nw.cardShadow}`}>
          <Text
            className={`text-[22px] font-semibold ${nw.textInk}`}
            testID="main-home-title"
          >
            Welcome to ABStrack
          </Text>

          {showHealthCheck && healthCheck && (
            <View
              className={`my-3 rounded-lg p-3 ${
                healthCheck.success
                  ? nw.healthSuccessPanel
                  : nw.healthFailurePanel
              }`}
            >
              <Text
                className={`mb-1 text-sm font-semibold ${
                  healthCheck.success
                    ? nw.healthSuccessTitle
                    : nw.healthFailureTitle
                }`}
              >
                {healthCheck.success
                  ? '✓ Health Check Passed'
                  : '✗ Health Check Failed'}
              </Text>
              <Text
                className={`text-xs ${
                  healthCheck.success
                    ? nw.healthSuccessBody
                    : nw.healthFailureBody
                }`}
              >
                {healthCheck.message}
              </Text>
              {healthCheck.error && (
                <Text
                  className={`mt-2 font-mono text-[10px] ${
                    healthCheck.success
                      ? nw.healthSuccessBody
                      : nw.healthFailureBody
                  }`}
                >
                  Error: {healthCheck.error}
                </Text>
              )}
            </View>
          )}

          <Text className={`text-base ${nw.textMuted}`}>
            You are signed in.
          </Text>
          {signOutError ? (
            <Text
              className={`text-sm ${nw.textError}`}
              accessibilityRole="alert"
            >
              {signOutError}
            </Text>
          ) : null}
          <View className="h-2" />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go to settings"
            onPress={onGoToSettings}
            className={`min-h-[52px] items-center justify-center rounded-[10px] px-4 ${nw.btnSecondary}`}
          >
            <Text
              className={`text-center text-[17px] font-semibold ${nw.textPrimary}`}
            >
              Settings
            </Text>
          </Pressable>

          <View className="h-2" />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={signOutBusy ? 'Signing out...' : 'Sign out'}
            onPress={handleSignOut}
            disabled={signOutBusy}
            className={`min-h-[52px] items-center justify-center rounded-[10px] px-4 ${nw.btnPrimary} ${signOutBusy ? 'opacity-60' : ''}`}
          >
            <Text className={`text-lg font-bold ${nw.textOnPrimary}`}>
              {signOutBusy ? 'Signing out...' : 'Sign out'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </AppNavigationShell>
  );
}
