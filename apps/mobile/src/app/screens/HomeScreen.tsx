import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { signOut } from '@abstrack/supabase';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import { mapAuthError } from '../auth-helpers';
import { ScreenShell } from '../components/ScreenShell';
import { styles } from '../styles';

export function HomeScreen() {
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const handleSignOut = async () => {
    const mobileSupabase = getMobileSupabaseClient();
    setSignOutBusy(true);
    setSignOutError(null);

    const { error } = await signOut(mobileSupabase);

    if (error) {
      setSignOutError(mapAuthError(error.message));
    }

    setSignOutBusy(false);
  };

  return (
    <ScreenShell>
      <Text style={styles.title} testID="main-home-title">
        Welcome to ABStrack
      </Text>
      <Text style={styles.bodyText}>You are signed in.</Text>
      {signOutError ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {signOutError}
        </Text>
      ) : null}
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
