import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { EpisodeRow } from '@abstrack/types';
import { healthCheckProfilesLimit1, signOut } from '@abstrack/supabase';
import { useMobileAuthUserId } from '../../lib/auth/use-mobile-auth-user-id';
import { PowerSyncActiveEpisodeSubscription } from '../../lib/powersync/PowerSyncActiveEpisodeSubscription';
import {
  powerSyncOfflineReplicaReadsEnabled,
  usePowerSyncBridgeState,
} from '../../lib/powersync/PowerSyncSessionBridge';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import { mapAuthError } from '../auth-helpers';
import {
  EpisodeStartHomeCta,
  episodeRowToActiveHomeSummary,
  type ActiveEpisodeHomeSummary,
} from '../components/episode-flow/EpisodeStartHomeCta';
import { AppNavigationShell } from '../components/AppNavigationShell';
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
  const isTestEnv =
    typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
  const showHealthCheck = __DEV__ && !isTestEnv;
  const isMountedRef = useRef(true);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [healthCheck, setHealthCheck] = useState<HealthCheckResult | null>(
    null,
  );

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

  /**
   * Episode CTA loading: only while PowerSync is configured, we have a user id, and local SQLite
   * has not finished `init` yet. After that, the home row is driven purely from
   * {@link PowerSyncActiveEpisodeSubscription} snapshot updates (no Supabase episode fetch).
   */
  const activeEpisodeLoading = useMemo(
    () =>
      Boolean(
        psBridge.powerSyncUrlConfigured &&
          userId &&
          !psBridge.localSqliteInitialized,
      ),
    [psBridge.powerSyncUrlConfigured, psBridge.localSqliteInitialized, userId],
  );

  const homeActiveEpisode = useMemo((): ActiveEpisodeHomeSummary | null => {
    if (!userId) {
      return null;
    }
    if (!powerSyncOfflineReplicaReadsEnabled(psBridge)) {
      return null;
    }
    const row = psEpisodeSnap.episode;
    if (!row) {
      return null;
    }
    return episodeRowToActiveHomeSummary(row);
  }, [userId, psBridge, psEpisodeSnap.episode]);

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
      {psBridge.database ? (
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
