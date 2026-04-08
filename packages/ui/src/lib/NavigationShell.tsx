import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { defaultPalette, highContrastPalette } from './styles/theme.js';

export type NavigationShellProps = ViewProps & {
  /** Top app bar / navigation row (e.g. title and actions). */
  header?: ReactNode;
  /** Main scrollable or static content. */
  children: ReactNode;
  /** Optional footer (e.g. tab bar host). */
  footer?: ReactNode;
  /** High-contrast background and borders for chrome regions. */
  highContrast?: boolean;
  style?: StyleProp<ViewStyle>;
  headerStyle?: StyleProp<ViewStyle>;
  mainStyle?: StyleProp<ViewStyle>;
  footerStyle?: StyleProp<ViewStyle>;
};

/**
 * Column layout for app chrome: optional header, main region, optional footer.
 * Intended to sit under a safe-area provider in consuming apps.
 *
 * @param props - Shell props.
 * @returns Layout container.
 */
export function NavigationShell({
  header,
  children,
  footer,
  highContrast = false,
  style,
  headerStyle,
  mainStyle,
  footerStyle,
  ...rest
}: NavigationShellProps) {
  const palette = highContrast ? highContrastPalette : defaultPalette;

  return (
    <View
      {...rest}
      accessibilityRole="none"
      style={[styles.root, { backgroundColor: palette.background }, style]}
    >
      {header ? (
        <View
          style={[
            styles.header,
            {
              borderBottomColor: palette.border,
              backgroundColor: palette.surface,
            },
            highContrast ? styles.headerHighContrast : null,
            headerStyle,
          ]}
          accessibilityRole="header"
        >
          {header}
        </View>
      ) : null}
      <View style={[styles.main, mainStyle]}>{children}</View>
      {footer ? (
        <View
          style={[
            styles.footer,
            {
              borderTopColor: palette.border,
              backgroundColor: palette.surface,
            },
            highContrast ? styles.footerHighContrast : null,
            footerStyle,
          ]}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'column',
  },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerHighContrast: {
    borderBottomWidth: 2,
  },
  main: {
    flex: 1,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  footerHighContrast: {
    borderTopWidth: 2,
  },
});
