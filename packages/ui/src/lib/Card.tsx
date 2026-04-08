import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { defaultPalette, highContrastPalette } from './styles/theme.js';

export type CardProps = ViewProps & {
  children: ReactNode;
  /** Optional title announced with the card when `accessibilityLabel` is not provided. */
  title?: string;
  /** Stronger borders for high-contrast presentation. */
  highContrast?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Grouped surface container with a clear border and padding.
 *
 * @param props - Card props.
 * @returns Card container view.
 */
export function Card({
  children,
  title,
  highContrast = false,
  accessibilityLabel,
  style,
  ...rest
}: CardProps) {
  const palette = highContrast ? highContrastPalette : defaultPalette;
  const label = accessibilityLabel ?? title;

  return (
    <View
      {...rest}
      accessibilityRole="none"
      accessibilityLabel={label}
      style={[
        styles.card,
        {
          borderColor: palette.border,
          backgroundColor: palette.surface,
        },
        highContrast ? styles.cardHighContrast : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 16,
  },
  cardHighContrast: {
    borderWidth: 2,
  },
});
