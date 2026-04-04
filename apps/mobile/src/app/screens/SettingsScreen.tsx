import React, { useEffect, useRef, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import {
  getRequireReauthOnOpenPreference,
  setRequireReauthOnOpenPreference,
} from '../reauth-preference';
import { ScreenShell } from '../components/ScreenShell';
import { styles } from '../styles';

export function SettingsScreen() {
  const isMountedRef = useRef(true);
  const [requireReauth, setRequireReauth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  return (
    <ScreenShell>
      <Text style={styles.title}>Settings</Text>
      <View style={styles.settingRow}>
        <View style={styles.settingTextBlock}>
          <Text style={styles.labelText}>
            Require re-authentication on app open
          </Text>
          <Text style={styles.bodyText}>
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
        />
      </View>
      {errorMessage ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {errorMessage}
        </Text>
      ) : null}
      {loading ? <Text style={styles.bodyText}>Loading setting...</Text> : null}
      {saving ? <Text style={styles.bodyText}>Saving setting...</Text> : null}
    </ScreenShell>
  );
}
