import type { ReactNode } from 'react';
import {
  Modal as RNModal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { defaultPalette, highContrastPalette } from './styles/theme.js';

export type DialogProps = {
  /** Whether the dialog is visible. */
  open: boolean;
  /** Called when the user dismisses the dialog (backdrop, hardware back, Escape on web). */
  onRequestClose: () => void;
  /** Optional title shown at the top of the dialog. */
  title?: string;
  /** Dialog body. */
  children: ReactNode;
  /** High-contrast palette for surfaces and text. */
  highContrast?: boolean;
  /** Minimum width for the sheet on large screens (dp). */
  minWidth?: number;
};

const MAX_WIDTH_RATIO = 0.92;

/**
 * Modal dialog with backdrop dismiss, title region, and scrollable-friendly body.
 * Uses React Native `Modal` so it works on native and on web via `react-native-web`.
 *
 * @param props - Dialog props.
 * @returns Modal dialog element.
 */
export function Dialog({
  open,
  onRequestClose,
  title,
  children,
  highContrast = false,
  minWidth = 280,
}: DialogProps) {
  const palette = highContrast ? highContrastPalette : defaultPalette;
  const { width: windowWidth } = useWindowDimensions();
  const maxCardWidth = Math.min(windowWidth * MAX_WIDTH_RATIO, 520);

  return (
    <RNModal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onRequestClose}
      accessibilityViewIsModal
    >
      <View style={styles.root} accessibilityLabel={title}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss dialog"
          onPress={onRequestClose}
          style={styles.backdrop}
        />
        <View style={styles.center} accessibilityRole="none">
          <View
            style={[
              styles.sheet,
              {
                minWidth: Math.min(minWidth, maxCardWidth),
                maxWidth: maxCardWidth,
                borderColor: palette.border,
                backgroundColor: palette.surface,
              },
              highContrast ? styles.sheetHighContrast : null,
            ]}
            accessibilityViewIsModal
            accessibilityLabel={title}
          >
            {title ? (
              <Text style={[styles.title, { color: palette.text }]}>
                {title}
              </Text>
            ) : null}
            <View style={styles.body}>{children}</View>
          </View>
        </View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    pointerEvents: 'box-none',
  },
  sheet: {
    width: '100%',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  sheetHighContrast: {
    borderWidth: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  body: {
    gap: 8,
  },
});
