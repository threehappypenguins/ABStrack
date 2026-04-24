import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  getActiveEpisodeForUser,
  getAuthUser,
  healthCheckProfilesLimit1,
  signOut,
} from '@abstrack/supabase';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import { mapAuthError } from '../auth-helpers';
import {
  EpisodeStartHomeCta,
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
  onGoToEpisodes: () => void;
  onGoToFoodDiary: () => void;
  onGoToStandaloneHealthMarkers: () => void;
  onStartEpisode: () => void;
  onResumeEpisode: (episode: ActiveEpisodeHomeSummary) => void;
};

export function HomeScreen({
  onGoToSettings,
  onGoToEpisodes,
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
  const [activeEpisode, setActiveEpisode] =
    useState<ActiveEpisodeHomeSummary | null>(null);
  const [activeEpisodeLoading, setActiveEpisodeLoading] = useState(true);

  /** Bumped on each load start and on blur/unmount so in-flight loads never win over newer work. */
  const loadGenerationRef = useRef(0);

  const loadActiveEpisode = useCallback(
    async (cancel?: { cancelled: boolean }) => {
      const generation = ++loadGenerationRef.current;
      const stale = () =>
        cancel?.cancelled === true || generation !== loadGenerationRef.current;

      setActiveEpisodeLoading(true);
      try {
        const mobileSupabase = getMobileSupabaseClient();
        const {
          data: { user },
        } = await mobileSupabase.auth.getUser();
        if (stale()) {
          return;
        }
        if (!user) {
          setActiveEpisode(null);
          return;
        }
        const result = await getActiveEpisodeForUser(mobileSupabase, user.id);
        if (stale()) {
          return;
        }
        if (!result.ok || !result.data) {
          setActiveEpisode(null);
          return;
        }
        const hasSymptomResumePath = !!result.data.symptom_preset_id;
        const hasEndStepResumePath =
          result.data.post_marker_step_completed_at != null;
        if (!hasSymptomResumePath && !hasEndStepResumePath) {
          setActiveEpisode(null);
          return;
        }
        if (hasEndStepResumePath) {
          setActiveEpisode({
            episodeId: result.data.id,
            resumeAtHealthMarkers: true,
            symptomPresetId: result.data.symptom_preset_id,
          });
          return;
        }
        setActiveEpisode({
          episodeId: result.data.id,
          symptomPresetId: result.data.symptom_preset_id as string,
          resumeAtHealthMarkers: false,
        });
      } catch {
        if (!stale()) {
          setActiveEpisode(null);
        }
      } finally {
        if (!stale()) {
          setActiveEpisodeLoading(false);
        }
      }
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      const cancel = { cancelled: false };
      void loadActiveEpisode(cancel);
      return () => {
        cancel.cancelled = true;
        loadGenerationRef.current += 1;
      };
    }, [loadActiveEpisode]),
  );

  useEffect(() => {
    const supabase = getMobileSupabaseClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        void loadActiveEpisode();
      }
    });
    return () => {
      subscription.unsubscribe();
      loadGenerationRef.current += 1;
    };
  }, [loadActiveEpisode]);

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
          data: { user },
          error: userError,
        } = await getAuthUser(mobileSupabase);

        if (userError || !user) {
          if (isMountedRef.current) {
            setHealthCheck({
              success: false,
              message: 'Health check failed',
              error: userError?.message ?? 'No authenticated user found',
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
        if (isMountedRef.current) {
          setHealthCheck({
            success: false,
            message: 'Health check error',
            error: err instanceof Error ? err.message : 'Unknown error',
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
          activeEpisode={activeEpisode}
          activeEpisodeLoading={activeEpisodeLoading}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open episodes list"
          onPress={onGoToEpisodes}
          className={`mb-1 min-h-[48px] justify-center rounded-xl border border-app-border bg-app-surface px-4 py-3 dark:border-app-border-dark dark:bg-app-surface-dark`}
        >
          <Text
            className={`text-center text-base font-semibold ${nw.textPrimary}`}
            maxFontSizeMultiplier={2}
          >
            Episodes
          </Text>
        </Pressable>
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
