import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { announce } from '@abstrack/ui/native';

const DISCARD_TITLE = 'Discard unsaved changes?';
const DISCARD_MESSAGE =
  'You have edits that are not saved yet. If you leave now, those changes will be lost.';

function showDiscardAlert(onDiscard: () => void): void {
  Alert.alert(DISCARD_TITLE, DISCARD_MESSAGE, [
    { text: 'Keep editing', style: 'cancel' },
    {
      text: 'Discard changes',
      style: 'destructive',
      onPress: onDiscard,
    },
  ]);
}

export type UseUnsavedChangesBeforeRemoveOptions = {
  /** While true, leaving is blocked without a discard prompt (e.g. save in flight). */
  busy?: boolean;
  /** Navigate to the episode template list (Cancel button and after confirmed discard). */
  onNavigateToList: () => void;
};

/**
 * Intercepts stack back (header, Android hardware back, gestures) when there are unsaved edits.
 * Leaving the Templates tab is handled by `EpisodeTemplatesLeavingGuardTabButton` and
 * `useEpisodeTemplatesDraftRegistration` in the main tab bar (parent `tabPress` listeners are
 * unreliable with nested stacks and focus timing).
 */
export function useUnsavedChangesBeforeRemove(
  isDirty: boolean,
  navigation: NavigationProp<ParamListBase>,
  options: UseUnsavedChangesBeforeRemoveOptions,
): {
  prepareLeaveWithoutConfirmation: () => void;
  requestCancelToList: () => void;
} {
  const { busy = false, onNavigateToList } = options;
  const allowLeaveRef = useRef(false);

  const prepareLeaveWithoutConfirmation = useCallback(() => {
    allowLeaveRef.current = true;
  }, []);

  const requestCancelToList = useCallback(() => {
    if (busy) {
      announce('Please wait for the current action to finish.');
      return;
    }
    if (!isDirty) {
      onNavigateToList();
      return;
    }
    showDiscardAlert(() => {
      allowLeaveRef.current = true;
      onNavigateToList();
    });
  }, [busy, isDirty, onNavigateToList]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (allowLeaveRef.current) {
        return;
      }
      if (busy) {
        e.preventDefault();
        announce('Please wait for the current action to finish.');
        return;
      }
      if (!isDirty) {
        return;
      }
      e.preventDefault();
      showDiscardAlert(() => {
        allowLeaveRef.current = true;
        navigation.dispatch(e.data.action);
      });
    });
    return unsubscribe;
  }, [busy, isDirty, navigation]);

  return { prepareLeaveWithoutConfirmation, requestCancelToList };
}
