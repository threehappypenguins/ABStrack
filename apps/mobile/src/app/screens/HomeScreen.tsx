import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { signOut, healthCheckProfilesLimit1 } from '@abstrack/supabase';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import { mapAuthError } from '../auth-helpers';
import { ScreenShell } from '../components/ScreenShell';
import { styles } from '../styles';

interface HealthCheckResult {
  success: boolean;
  message: string;
  error?: string;
}

type HomeScreenProps = {
  onGoToSettings: () => void;
};

export function HomeScreen({ onGoToSettings }: HomeScreenProps) {
  const showHealthCheck = __DEV__;
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

    // Run health check on component mount to validate env, session, and RLS
    const runHealthCheck = async () => {
      try {
        const mobileSupabase = getMobileSupabaseClient();
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
                'Health check passed: profiles query executed without API error (empty rows may still indicate no profile or restrictive RLS).',
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
    <ScreenShell>
      <Text style={styles.title} testID="main-home-title">
        Welcome to ABStrack
      </Text>

      {/* Health Check Status - only render once result is available */}
      {showHealthCheck && healthCheck && (
        <View
          style={[
            styles.healthCheckContainer,
            healthCheck.success
              ? styles.healthCheckContainerSuccess
              : styles.healthCheckContainerFailure,
          ]}
        >
          <Text
            style={[
              styles.healthCheckTitleText,
              healthCheck.success
                ? styles.healthCheckTitleTextSuccess
                : styles.healthCheckTitleTextFailure,
            ]}
          >
            {healthCheck.success
              ? '✓ Health Check Passed'
              : '✗ Health Check Failed'}
          </Text>
          <Text
            style={[
              styles.healthCheckBodyText,
              healthCheck.success
                ? styles.healthCheckBodyTextSuccess
                : styles.healthCheckBodyTextFailure,
            ]}
          >
            {healthCheck.message}
          </Text>
          {healthCheck.error && (
            <Text
              style={[
                styles.healthCheckErrorText,
                healthCheck.success
                  ? styles.healthCheckErrorTextSuccess
                  : styles.healthCheckErrorTextFailure,
              ]}
            >
              Error: {healthCheck.error}
            </Text>
          )}
        </View>
      )}

      <Text style={styles.bodyText}>You are signed in.</Text>
      {signOutError ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {signOutError}
        </Text>
      ) : null}
      <View style={styles.spacer} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go to settings"
        onPress={onGoToSettings}
        style={styles.secondaryButton}
      >
        <Text style={styles.secondaryButtonText}>Settings</Text>
      </Pressable>

      <View style={styles.spacer} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={signOutBusy ? 'Signing out...' : 'Sign out'}
        onPress={handleSignOut}
        disabled={signOutBusy}
        style={[
          styles.primaryButton,
          signOutBusy ? styles.primaryButtonDisabled : null,
        ]}
      >
        <Text style={styles.primaryButtonText}>
          {signOutBusy ? 'Signing out...' : 'Sign out'}
        </Text>
      </Pressable>
    </ScreenShell>
  );
}
