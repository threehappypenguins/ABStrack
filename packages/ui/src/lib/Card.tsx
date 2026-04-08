import type { ReactNode } from 'react';
import {
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { defaultPalette, highContrastPalette } from './styles/theme.js';

export type CardProps = ViewProps & {
  children: ReactNode;
  /**
   * Optional title for the card. When set (or when `accessibilityLabel` is), the container is
   * focusable for assistive tech (`accessible`), labeled, and uses `role="group"` on web.
   */
  title?: string;
  /** Stronger borders for high-contrast presentation. */
  highContrast?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Grouped surface container with a clear border and padding.
 * With a `title` or `accessibilityLabel`, the container is labeled and `accessible` on native; on web it uses `role="group"`. Otherwise it is presentational (`accessibilityRole="none"`).
 *
 * @param props - Card props.
 * @returns Card container view.
 */
export function Card({
  children,
  title,
  highContrast = false,
  accessibilityLabel,
  accessible,
  style,
  ...rest
}: CardProps) {
  const palette = highContrast ? highContrastPalette : defaultPalette;
  const label = accessibilityLabel ?? title;
  const trimmed = label?.trim() ?? '';
  const hasNamedRegion = trimmed.length > 0;

  return (
    <View
      {...rest}
      accessibilityLabel={hasNamedRegion ? trimmed : undefined}
      accessibilityRole={hasNamedRegion ? undefined : 'none'}
      accessible={hasNamedRegion ? true : accessible}
      role={
        hasNamedRegion && Platform.OS === 'web' ? 'group' : undefined
      }
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
