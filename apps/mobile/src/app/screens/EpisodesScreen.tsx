import React from 'react';
import { useNavigation } from '@react-navigation/native';
import {
  EpisodesManagementPanel,
  type EpisodesManagementNav,
} from './EpisodesManagementPanel';

/**
 * @deprecated Episodes are opened from Manage; this wrapper remains for test compatibility
 *   with existing `EpisodesScreen` specs.
 *
 * @returns Standalone episode management screen.
 */
export function EpisodesScreen() {
  const navigation = useNavigation<EpisodesManagementNav>();
  return (
    <EpisodesManagementPanel navigation={navigation} variant="standalone" />
  );
}
