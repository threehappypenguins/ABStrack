import React from 'react';
import { useNavigation } from '@react-navigation/native';
import {
  EpisodesManagementPanel,
  type EpisodesManagementNav,
} from './EpisodesManagementPanel';

/**
 * @deprecated Episodes are opened from the Manage tab; this wrapper remains for tests and any
 *   deep links until navigation is fully consolidated.
 *
 * @returns Standalone episode management screen.
 */
export function EpisodesScreen() {
  const navigation = useNavigation<EpisodesManagementNav>();
  return (
    <EpisodesManagementPanel navigation={navigation} variant="standalone" />
  );
}
