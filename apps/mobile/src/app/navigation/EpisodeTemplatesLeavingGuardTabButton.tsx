import React, { useCallback } from 'react';
import { Alert, GestureResponderEvent, Pressable } from 'react-native';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { useNavigationState } from '@react-navigation/native';
import { announce } from '@abstrack/ui/native';
import type { MainTabParamList } from './types';
import { useEpisodeTemplatesDraftRef } from './EpisodeTemplatesDraftContext';

const DISCARD_TITLE = 'Discard unsaved changes?';
const DISCARD_MESSAGE =
  'You have edits that are not saved yet. If you leave now, those changes will be lost.';

type Props = BottomTabBarButtonProps & {
  /** Tab this button switches to (from the enclosing screen’s route). */
  targetRoute: keyof MainTabParamList;
};

/**
 * Wraps the default tab bar button so leaving the Templates tab from create/edit can prompt or
 * reset the nested stack — implemented here instead of `navigation.addListener('tabPress')`,
 * which is easy to get wrong with focus timing and mounted-but-hidden screens.
 */
export function EpisodeTemplatesLeavingGuardTabButton({
  targetRoute,
  onPress,
  ...rest
}: Props) {
  const draftRef = useEpisodeTemplatesDraftRef();

  const tabSituation = useNavigationState((state) => {
    if (!state?.routes || typeof state.index !== 'number') {
      return {
        currentTab: undefined as keyof MainTabParamList | undefined,
        nested: undefined as string | undefined,
      };
    }
    const current = state.routes[state.index] as {
      name: string;
      state?: { routes: { name: string }[]; index: number };
    };
    const currentTab = current?.name as keyof MainTabParamList;
    let nested: string | undefined;
    if (current?.name === 'EpisodeTemplates' && current.state?.routes?.length) {
      const st = current.state;
      nested = st.routes[st.index]?.name;
    }
    return { currentTab, nested };
  });

  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      const { currentTab, nested } = tabSituation;

      if (
        currentTab !== 'EpisodeTemplates' ||
        (nested !== 'EpisodeTemplateCreate' && nested !== 'EpisodeTemplateEdit')
      ) {
        onPress?.(e);
        return;
      }

      if (targetRoute === 'EpisodeTemplates') {
        onPress?.(e);
        return;
      }

      const draft = draftRef.current;
      if (!draft) {
        onPress?.(e);
        return;
      }

      if (draft.busy) {
        announce('Please wait for the current action to finish.');
        return;
      }

      const go = () => {
        draft.navigateToList();
        onPress?.(e);
      };

      if (!draft.isDirty) {
        go();
        return;
      }

      Alert.alert(DISCARD_TITLE, DISCARD_MESSAGE, [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard changes',
          style: 'destructive',
          onPress: go,
        },
      ]);
    },
    [draftRef, onPress, tabSituation, targetRoute],
  );

  return (
    <Pressable
      {...(rest as React.ComponentPropsWithoutRef<typeof Pressable>)}
      onPress={handlePress}
    />
  );
}
