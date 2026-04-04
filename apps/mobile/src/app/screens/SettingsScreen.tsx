import React, { useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import {
  getRequireReauthOnOpenPreference,
  setRequireReauthOnOpenPreference,
} from '../reauth-preference';
import { ScreenShell } from '../components/ScreenShell';
import { styles } from '../styles';

export function SettingsScreen() {
  const [requireReauth, setRequireReauth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadPreference = async () => {
      try {
        const enabled = await getRequireReauthOnOpenPreference();

        if (mounted) {
          setRequireReauth(enabled);
        }
      } catch {
        if (mounted) {
          setErrorMessage('Unable to load your setting right now. Try again.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadPreference();

    return () => {
      mounted = false;
    };
  }, []);

  const onTogglePreference = async (nextValue: boolean) => {
    setSaving(true);
    setErrorMessage(null);

    try {
      await setRequireReauthOnOpenPreference(nextValue);
      setRequireReauth(nextValue);
    } catch {
      setErrorMessage('Unable to save your setting right now. Try again.');
    } finally {
      setSaving(false);
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
