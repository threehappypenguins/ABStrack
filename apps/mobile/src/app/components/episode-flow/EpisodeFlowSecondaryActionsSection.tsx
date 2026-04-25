import type { ReactNode } from 'react';
import { View } from 'react-native';

export type EpisodeFlowSecondaryActionsSectionProps = {
  children: ReactNode;
};

/**
 * Shared in-scroll container for low-priority / destructive episode-flow actions.
 * Keeps spacing and divider styling consistent across mobile round screens.
 */
export function EpisodeFlowSecondaryActionsSection({
  children,
}: EpisodeFlowSecondaryActionsSectionProps) {
  return (
    <View className="mt-6 border-t border-app-border pt-4 dark:border-app-border-dark">
      {children}
    </View>
  );
}
