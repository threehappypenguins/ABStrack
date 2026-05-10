import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Switch, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { announce } from '@abstrack/ui/native';
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
import {
  fetchCaretakerAccessCancelPendingInvite,
  fetchCaretakerAccessDelete,
  fetchCaretakerAccessGet,
  fetchCaretakerAccessPost,
  resolvePatientCaretakerAccessUrl,
} from '../../lib/patient-user-web-api';
import { getMobileAuthSessionSafe } from '../../lib/supabase-wiring';

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

type CaretakerGrantDto = {
  id: string;
  caretakerUserId: string;
  caretakerDisplayName: string | null;
  createdAt: string;
};

type CaretakerPendingInviteDto = {
  inviteeEmail: string;
  expiresAt: string;
  lastInviteSentAt: string | null;
  createdAt: string | null;
};

const caretakerInputClassName = `min-h-[52px] rounded-lg px-3 py-2.5 text-base ${nw.input}`;

export function SettingsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { colors, themePreference, setThemePreference } = useAppTheme();
  const patientCaretakerApiUrl = resolvePatientCaretakerAccessUrl();
  const isMountedRef = useRef(true);
  const [requireReauth, setRequireReauth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [themeSaving, setThemeSaving] = useState(false);
  const powerSyncBridge = usePowerSyncBridgeState();
  const [powerSyncDiagBusy, setPowerSyncDiagBusy] = useState(false);
  const [caretakerGrant, setCaretakerGrant] = useState<
    CaretakerGrantDto | null | undefined
  >(undefined);
  const [caretakerPendingInvite, setCaretakerPendingInvite] =
    useState<CaretakerPendingInviteDto | null>(null);
  const [caretakerLoadError, setCaretakerLoadError] = useState<string | null>(
    null,
  );
  const [caretakerBusy, setCaretakerBusy] = useState(false);
  const [caretakerEmail, setCaretakerEmail] = useState('');
  const [caretakerFormError, setCaretakerFormError] = useState<string | null>(
    null,
  );

  const loadCaretakerGrant = useCallback(async () => {
    if (!patientCaretakerApiUrl) {
      return;
    }
    setCaretakerLoadError(null);
    try {
      const {
        data: { session },
        error: sessionError,
      } = await getMobileAuthSessionSafe();
      if (sessionError || !session?.access_token?.trim()) {
        if (isMountedRef.current) {
          setCaretakerGrant(null);
          setCaretakerPendingInvite(null);
          setCaretakerLoadError(
            'Sign in with a network connection to manage caretaker access from this screen.',
          );
        }
        return;
      }
      const res = await fetchCaretakerAccessGet(session.access_token);
      if (res.status === 403) {
        if (isMountedRef.current) {
          setCaretakerGrant(null);
          setCaretakerPendingInvite(null);
          setCaretakerLoadError(
            'Caretaker linking is only available to patient accounts.',
          );
        }
        return;
      }
      if (!res.ok) {
        if (isMountedRef.current) {
          setCaretakerGrant(null);
          setCaretakerPendingInvite(null);
          setCaretakerLoadError(
            'Unable to load caretaker access. Confirm EXPO_PUBLIC_SUPABASE_URL, deploy the patient-caretaker-access Edge Function, and try again.',
          );
        }
        return;
      }
      const body = (await res.json()) as {
        grant: CaretakerGrantDto | null;
        pendingInvite?: CaretakerPendingInviteDto | null;
      };
      if (isMountedRef.current) {
        setCaretakerGrant(body.grant);
        setCaretakerPendingInvite(body.pendingInvite ?? null);
      }
    } catch {
      if (isMountedRef.current) {
        setCaretakerGrant(null);
        setCaretakerPendingInvite(null);
        setCaretakerLoadError(
          'Unable to load caretaker access. Check your network connection.',
        );
      }
    }
  }, [patientCaretakerApiUrl]);

  useEffect(() => {
    if (!patientCaretakerApiUrl) {
      if (isMountedRef.current) {
        setCaretakerGrant(null);
        setCaretakerPendingInvite(null);
        setCaretakerLoadError(null);
        setCaretakerFormError(null);
      }
      return;
    }
    void loadCaretakerGrant();
  }, [patientCaretakerApiUrl, loadCaretakerGrant]);

  const onCancelPendingCaretakerInvite = async () => {
    setCaretakerBusy(true);
    setCaretakerFormError(null);
    try {
      const {
        data: { session },
        error: sessionError,
      } = await getMobileAuthSessionSafe();
      if (sessionError || !session?.access_token?.trim()) {
        setCaretakerFormError(
          'You must be signed in with a valid session to cancel an invite.',
        );
        return;
      }
      const res = await fetchCaretakerAccessCancelPendingInvite(
        session.access_token,
      );
      const maybe = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        const msg =
          typeof maybe.error === 'string'
            ? maybe.error
            : 'Unable to cancel the invite.';
        setCaretakerFormError(msg);
        announce(msg, { politeness: 'assertive' });
        return;
      }
      announce('Pending caretaker invite cancelled.', { politeness: 'polite' });
      await loadCaretakerGrant();
    } catch {
      setCaretakerFormError(
        'Something went wrong. Check EXPO_PUBLIC_SUPABASE_URL, Edge Function deploy, and network, then try again.',
      );
    } finally {
      if (isMountedRef.current) {
        setCaretakerBusy(false);
      }
    }
  };

  const onInviteCaretaker = async () => {
    const trimmed = caretakerEmail.trim();
    if (!trimmed) {
      setCaretakerFormError('Enter the caretaker’s email address.');
      return;
    }
    setCaretakerBusy(true);
    setCaretakerFormError(null);
    try {
      const {
        data: { session },
        error: sessionError,
      } = await getMobileAuthSessionSafe();
      if (sessionError || !session?.access_token?.trim()) {
        setCaretakerFormError(
          'You must be signed in with a valid session to invite or link a caretaker.',
        );
        return;
      }
      const res = await fetchCaretakerAccessPost(session.access_token, trimmed);
      const maybe = (await res.json().catch(() => ({}))) as {
        error?: string;
        outcome?: string;
      };
      if (!res.ok) {
        const msg =
          typeof maybe.error === 'string'
            ? maybe.error
            : 'Unable to invite or link caretaker access.';
        setCaretakerFormError(msg);
        announce(msg, { politeness: 'assertive' });
        return;
      }
      setCaretakerEmail('');
      if (maybe.outcome === 'invite_sent') {
        announce(
          'Invite email sent. They should open the link in that message to finish as a caretaker.',
          { politeness: 'polite' },
        );
      } else if (maybe.outcome === 'already_linked') {
        announce('That caretaker is already linked to your account.', {
          politeness: 'polite',
        });
      } else {
        announce(
          'Caretaker linked. They can sign in on their own device to help log for you.',
          { politeness: 'polite' },
        );
      }
      await loadCaretakerGrant();
    } catch {
      setCaretakerFormError(
        'Something went wrong. Check EXPO_PUBLIC_SUPABASE_URL, Edge Function deploy, and network, then try again.',
      );
    } finally {
      if (isMountedRef.current) {
        setCaretakerBusy(false);
      }
    }
  };

  const runRevokeCaretaker = async () => {
    setCaretakerBusy(true);
    setCaretakerFormError(null);
    try {
      const {
        data: { session },
        error: sessionError,
      } = await getMobileAuthSessionSafe();
      if (sessionError || !session?.access_token?.trim()) {
        setCaretakerFormError(
          'You must be signed in with a valid session to revoke caretaker access.',
        );
        return;
      }
      const res = await fetchCaretakerAccessDelete(session.access_token);
      const maybe = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        const msg =
          typeof maybe.error === 'string'
            ? maybe.error
            : 'Unable to revoke caretaker access.';
        setCaretakerFormError(msg);
        announce(msg, { politeness: 'assertive' });
        return;
      }
      announce('Caretaker access revoked.', { politeness: 'polite' });
      await loadCaretakerGrant();
    } catch {
      setCaretakerFormError(
        'Something went wrong. Check EXPO_PUBLIC_SUPABASE_URL, Edge Function deploy, and network, then try again.',
      );
    } finally {
      if (isMountedRef.current) {
        setCaretakerBusy(false);
      }
    }
  };

  const onConfirmRevokeCaretaker = () => {
    Alert.alert(
      'Revoke caretaker access?',
      'They will no longer be able to read or log your health data. Nothing already saved is deleted. You can link someone again later.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke access',
          style: 'destructive',
          onPress: () => void runRevokeCaretaker(),
        },
      ],
    );
  };

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

      <View className="my-2 h-px bg-app-border dark:bg-app-border-dark" />

      <View className="gap-2" accessibilityLabel="Caretaker access">
        <Text className={`text-base font-semibold ${nw.textInk}`}>
          Caretaker access
        </Text>
        <>
          <Text className={`text-base ${nw.textMuted}`}>
            A caretaker uses their own ABStrack account to run the same logging
            flows as you when you need help—on web or mobile, with the same data
            access as you once they accept an invite or you link them. This is
            not the same as a healthcare practitioner (separate practitioner
            app, read-only). New caretakers finish the email invite on the web
            link first; then they can use mobile too.
          </Text>
          {!patientCaretakerApiUrl ? (
            <Text
              className={`text-sm ${nw.textError}`}
              accessibilityRole="alert"
            >
              Missing EXPO_PUBLIC_SUPABASE_URL. Add it to apps/mobile/.env so
              invite and revoke can call your Supabase project Edge Function
              patient-caretaker-access (see repo supabase/functions).
            </Text>
          ) : null}
          {patientCaretakerApiUrl && caretakerLoadError ? (
            <Text
              className={`text-sm ${nw.textError}`}
              accessibilityRole="alert"
            >
              {caretakerLoadError}
            </Text>
          ) : null}
          {patientCaretakerApiUrl &&
          caretakerGrant === undefined &&
          !caretakerLoadError ? (
            <Text
              className={`text-base ${nw.textMuted}`}
              accessibilityLiveRegion="polite"
            >
              Loading caretaker access…
            </Text>
          ) : null}
          {patientCaretakerApiUrl &&
          caretakerPendingInvite &&
          !caretakerGrant &&
          caretakerGrant !== undefined &&
          !caretakerLoadError ? (
            <View className={`gap-3 rounded-xl border p-4 ${nw.card}`}>
              <Text className={`text-base font-semibold ${nw.textInk}`}>
                Invite pending
              </Text>
              <Text className={`text-sm ${nw.textMuted}`}>
                We sent an email to {caretakerPendingInvite.inviteeEmail}. They
                should use the link in that message to finish setup.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel pending caretaker invite"
                accessibilityState={{ disabled: caretakerBusy }}
                disabled={caretakerBusy}
                onPress={() => void onCancelPendingCaretakerInvite()}
                className={`min-h-[52px] justify-center rounded-xl border border-app-border bg-app-surface px-4 py-3 dark:border-app-border-dark ${caretakerBusy ? 'opacity-60' : ''}`}
              >
                <Text className={`text-base font-semibold ${nw.textInk}`}>
                  {caretakerBusy ? 'Working…' : 'Cancel pending invite'}
                </Text>
              </Pressable>
            </View>
          ) : null}
          {patientCaretakerApiUrl && caretakerGrant ? (
            <View className={`gap-3 rounded-xl border p-4 ${nw.card}`}>
              <Text className={`text-base font-semibold ${nw.textInk}`}>
                Active caretaker
              </Text>
              <Text
                className={`text-base ${nw.textInk}`}
                accessibilityLabel={`Caretaker display name: ${
                  caretakerGrant.caretakerDisplayName?.trim() ||
                  'Not set on their profile'
                }`}
              >
                {caretakerGrant.caretakerDisplayName?.trim()
                  ? caretakerGrant.caretakerDisplayName
                  : 'Display name not set on their profile'}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Revoke caretaker access"
                accessibilityHint="Opens a confirmation before removing access"
                accessibilityState={{ disabled: caretakerBusy }}
                disabled={caretakerBusy}
                onPress={onConfirmRevokeCaretaker}
                className={`min-h-[52px] justify-center rounded-xl border border-app-border bg-app-surface px-4 py-3 dark:border-app-border-dark ${caretakerBusy ? 'opacity-60' : ''}`}
              >
                <Text className={`text-base font-semibold ${nw.textError}`}>
                  {caretakerBusy ? 'Working…' : 'Revoke caretaker access'}
                </Text>
              </Pressable>
            </View>
          ) : null}
          {patientCaretakerApiUrl &&
          !caretakerGrant &&
          caretakerGrant !== undefined &&
          !caretakerLoadError ? (
            <View className={`gap-3 rounded-xl border p-4 ${nw.card}`}>
              <Text className={`text-base font-semibold ${nw.textInk}`}>
                Invite or link a caretaker
              </Text>
              <Text className={`text-sm ${nw.textMuted}`}>
                Enter their email. If they are new to ABStrack, we send an
                invite. If they already have a caretaker account, we link them
                right away.
              </Text>
              <TextInput
                accessibilityLabel="Caretaker email"
                accessibilityHint="Email they used to sign up as a caretaker"
                value={caretakerEmail}
                onChangeText={setCaretakerEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!caretakerBusy}
                placeholder="caretaker@example.com"
                className={caretakerInputClassName}
              />
              {caretakerFormError ? (
                <Text
                  className={`text-sm ${nw.textError}`}
                  accessibilityRole="alert"
                >
                  {caretakerFormError}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send caretaker invite or link"
                accessibilityState={{ disabled: caretakerBusy }}
                disabled={caretakerBusy}
                onPress={() => void onInviteCaretaker()}
                className={`min-h-[52px] justify-center rounded-xl ${nw.btnPrimary} px-4 py-3 ${caretakerBusy ? 'opacity-60' : ''}`}
              >
                <Text
                  className={`text-center text-base font-semibold ${nw.textOnPrimary}`}
                >
                  {caretakerBusy ? 'Sending…' : 'Send invite or link'}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </>
      </View>

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
