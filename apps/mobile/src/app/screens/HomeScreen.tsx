import React, { useState } from 'react';
import { Button, Text, View } from 'react-native';
import { signOut } from '@abstrack/supabase';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import { ScreenShell } from '../components/ScreenShell';
import { styles } from '../styles';

export function HomeScreen() {
  const [signOutBusy, setSignOutBusy] = useState(false);

  const handleSignOut = async () => {
    const mobileSupabase = getMobileSupabaseClient();
    setSignOutBusy(true);
    await signOut(mobileSupabase);
    setSignOutBusy(false);
  };

  return (
    <ScreenShell>
      <Text style={styles.title} testID="main-home-title">
        Welcome to ABStrack
      </Text>
      <Text style={styles.bodyText}>You are signed in.</Text>
      <View style={styles.spacer} />
      <Button
        title={signOutBusy ? 'Signing out...' : 'Sign out'}
        onPress={handleSignOut}
        disabled={signOutBusy}
      />
    </ScreenShell>
  );
}
