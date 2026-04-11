import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import {
  getAuthUser,
  healthCheckProfilesLimit1,
  signOut,
} from '@abstrack/supabase';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import { mapAuthError } from '../auth-helpers';
import { AppNavigationShell } from '../components/AppNavigationShell';
import { nw } from '../theme/app-nativewind-classes';

interface HealthCheckResult {
  success: boolean;
  message: string;
  error?: string;
}

type HomeScreenProps = {
  onGoToSettings: () => void;
};

export function HomeScreen({ onGoToSettings }: HomeScreenProps) {
  const isTestEnv =
    typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
  const showHealthCheck = __DEV__ && !isTestEnv;
  const isMountedRef = useRef(true);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [healthCheck, setHealthCheck] = useState<HealthCheckResult | null>(
    null,
  );

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
          justifyContent: 'center',
        }}
        keyboardShouldPersistTaps="handled"
      >
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
