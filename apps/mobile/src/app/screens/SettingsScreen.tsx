import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  getRequireReauthOnOpenPreference,
  setRequireReauthOnOpenPreference,
} from '../reauth-preference';
import { ScreenShell } from '../components/ScreenShell';
import {
  formatPowerSyncReplicaDiagnosticsMessage,
  isPowerSyncReplicaDiagnosticsEnabled,
  runPowerSyncReplicaDiagnostics,
} from '../../lib/powersync/powersync-replica-diagnostics';
import { usePowerSyncBridgeState } from '../../lib/powersync/PowerSyncSessionBridge';
import type { MainStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/AppThemeContext';
import { nw } from '../theme/app-nativewind-classes';
import type { ThemePreference } from '../theme-preference';

const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  hint: string;
}[] = [
  {
    value: 'system',
    label: 'System',
    hint: 'Match your device light or dark mode.',
  },
  {
    value: 'light',
    label: 'Light',
    hint: 'Always use light appearance.',
  },
  {
    value: 'dark',
    label: 'Dark',
    hint: 'Always use dark appearance.',
  },
];

export function SettingsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { colors, themePreference, setThemePreference } = useAppTheme();
  const isMountedRef = useRef(true);
  const [requireReauth, setRequireReauth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [themeSaving, setThemeSaving] = useState(false);
  const powerSyncBridge = usePowerSyncBridgeState();
  const [powerSyncDiagBusy, setPowerSyncDiagBusy] = useState(false);

  const onRunPowerSyncReplicaDiagnostics = useCallback(async () => {
    const db = powerSyncBridge.database;
    if (!db) {
      Alert.alert(
        'PowerSync replica',
        'No local database is open. Check that EXPO_PUBLIC_POWERSYNC_URL is set and you are signed in.',
      );
      return;
    }
    setPowerSyncDiagBusy(true);
    try {
      const result = await runPowerSyncReplicaDiagnostics(db);
      const body = formatPowerSyncReplicaDiagnosticsMessage(
        result,
        powerSyncBridge,
      );
      Alert.alert(
        result.ok ? 'PowerSync replica' : 'PowerSync replica (query failed)',
        body.length > 3500 ? `${body.slice(0, 3500)}\n…` : body,
      );
    } finally {
      setPowerSyncDiagBusy(false);
    }
  }, [powerSyncBridge]);

  useEffect(() => {
    isMountedRef.current = true;

    const loadPreference = async () => {
      try {
        const enabled = await getRequireReauthOnOpenPreference();

        if (isMountedRef.current) {
          setRequireReauth(enabled);
        }
      } catch {
        if (isMountedRef.current) {
          setErrorMessage('Unable to load your setting right now. Try again.');
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    };

    void loadPreference();

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const onTogglePreference = async (nextValue: boolean) => {
    setSaving(true);
    setErrorMessage(null);

    try {
      await setRequireReauthOnOpenPreference(nextValue);

      if (isMountedRef.current) {
        setRequireReauth(nextValue);
      }
    } catch {
      if (isMountedRef.current) {
        setErrorMessage('Unable to save your setting right now. Try again.');
      }
    } finally {
      if (isMountedRef.current) {
        setSaving(false);
      }
    }
  };

  const onSelectTheme = async (next: ThemePreference) => {
    setThemeError(null);
    setThemeSaving(true);
    try {
      await setThemePreference(next);
    } catch {
      if (isMountedRef.current) {
        setThemeError('Unable to save your theme choice. Try again.');
      }
    } finally {
      if (isMountedRef.current) {
        setThemeSaving(false);
      }
    }
  };

  return (
    <ScreenShell>
      <Text className={`text-[22px] font-semibold ${nw.textInk}`}>
        Settings
      </Text>

      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Color theme"
        className="gap-2"
      >
        <Text className={`text-base font-semibold ${nw.textInk}`}>
          Color theme
        </Text>
        <Text className={`text-base ${nw.textMuted}`}>
          Choose how ABStrack looks. System follows your device settings.
        </Text>
        {THEME_OPTIONS.map(({ value, label, hint }) => {
          const selected = themePreference === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: themeSaving }}
              accessibilityLabel={label}
              accessibilityHint={hint}
              disabled={themeSaving}
              onPress={() => void onSelectTheme(value)}
              className={`min-h-[52px] justify-center rounded-xl border px-4 py-3 ${
                selected
                  ? `border-2 border-app-primary bg-app-primary-soft dark:border-app-primary-dark dark:bg-app-primary-soft-dark ${nw.textInk}`
                  : `border border-app-border bg-app-surface dark:border-app-border-dark dark:bg-app-surface-dark ${nw.textInk}`
              } ${themeSaving ? 'opacity-60' : ''}`}
            >
              <Text className={`text-base font-semibold ${nw.textInk}`}>
                {label}
              </Text>
              <Text className={`mt-0.5 text-sm ${nw.textMuted}`}>{hint}</Text>
            </Pressable>
          );
        })}
      </View>
      {themeError ? (
        <Text className={`text-sm ${nw.textError}`} accessibilityRole="alert">
          {themeError}
        </Text>
      ) : null}

      <View className="my-2 h-px bg-app-border dark:bg-app-border-dark" />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open manage tab on episodes"
        onPress={() =>
          navigation.navigate('MainTabs', {
            screen: 'Manage',
            params: { initialSegment: 'episodes' },
          })
        }
        className={`min-h-[52px] justify-center rounded-xl border border-app-border bg-app-surface px-4 py-3 dark:border-app-border-dark dark:bg-app-surface-dark`}
      >
        <Text className={`text-base font-semibold ${nw.textInk}`}>
          Manage episodes
        </Text>
        <Text className={`mt-0.5 text-sm ${nw.textMuted}`}>
          Open the Manage tab to review episode history and resume an
          in-progress episode.
        </Text>
      </Pressable>

      {isPowerSyncReplicaDiagnosticsEnabled() ? (
        <>
          <View className="my-2 h-px bg-app-border dark:bg-app-border-dark" />
          <View className="gap-2">
            <Text className={`text-base font-semibold ${nw.textInk}`}>
              PowerSync replica (debug)
            </Text>
            <Text className={`text-base ${nw.textMuted}`}>
              Counts rows in the encrypted local replica. If decryption fails,
              you will see a query error instead of numbers. Does not log the
              encryption key. Filter logcat with PowerSyncReplicaDiag.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Run PowerSync replica diagnostics"
              accessibilityState={{ disabled: powerSyncDiagBusy }}
              disabled={powerSyncDiagBusy}
              onPress={() => void onRunPowerSyncReplicaDiagnostics()}
              className={`min-h-[52px] justify-center rounded-xl border border-app-border bg-app-surface px-4 py-3 dark:border-app-border-dark dark:bg-app-surface-dark ${powerSyncDiagBusy ? 'opacity-60' : ''}`}
            >
              <Text className={`text-base font-semibold ${nw.textInk}`}>
                {powerSyncDiagBusy ? 'Running…' : 'Run replica diagnostics'}
              </Text>
            </Pressable>
          </View>
        </>
      ) : null}

      <View className="my-2 h-px bg-app-border dark:bg-app-border-dark" />

      <View className="flex-row items-center gap-3">
        <View className="min-w-0 flex-1 gap-1.5">
          <Text className={`text-base font-semibold ${nw.textInk}`}>
            Require re-authentication on app open
          </Text>
          <Text className={`text-base ${nw.textMuted}`}>
            When enabled, you will be asked to log in every time you reopen the
            app.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Require re-authentication on app open"
          testID="require-reauth-switch"
          value={requireReauth}
          onValueChange={onTogglePreference}
          disabled={loading || saving}
          trackColor={{ false: colors.border, true: colors.primary }}
        />
      </View>
      {errorMessage ? (
        <Text className={`text-sm ${nw.textError}`} accessibilityRole="alert">
          {errorMessage}
        </Text>
      ) : null}
      {loading ? (
        <Text className={`text-base ${nw.textMuted}`}>Loading setting...</Text>
      ) : null}
      {saving ? (
        <Text className={`text-base ${nw.textMuted}`}>Saving setting...</Text>
      ) : null}
    </ScreenShell>
  );
}
