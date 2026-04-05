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
  const isMountedRef = useRef(true);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [healthCheck, setHealthCheck] = useState<HealthCheckResult | null>(
    null,
  );

  useEffect(() => {
    isMountedRef.current = true;

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
                'Health check passed: env vars, session, and RLS are functional',
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
  }, []);

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
      {healthCheck && (
        <View
          style={{
            marginVertical: 12,
            padding: 12,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: healthCheck.success ? '#16a34a' : '#dc2626',
            backgroundColor: healthCheck.success ? '#f0fdf4' : '#fef2f2',
          }}
        >
          <Text
            style={{
              fontSize: 14,
              fontWeight: '600',
              marginBottom: 4,
              color: healthCheck.success ? '#15803d' : '#991b1b',
            }}
          >
            {healthCheck.success
              ? '✓ Health Check Passed'
              : '✗ Health Check Failed'}
          </Text>
          <Text
            style={{
              fontSize: 12,
              color: healthCheck.success ? '#166534' : '#7f1d1d',
            }}
          >
            {healthCheck.message}
          </Text>
          {healthCheck.error && (
            <Text
              style={{
                fontSize: 10,
                marginTop: 8,
                color: healthCheck.success ? '#166534' : '#7f1d1d',
                fontFamily: 'monospace',
              }}
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
