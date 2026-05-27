import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  Path,
  Pattern,
  Rect,
  Stop,
} from 'react-native-svg';
import { useAppTheme } from '../theme/AppThemeContext';

const GRID_TILE_WIDTH = 14;
const GRID_TILE_HEIGHT = 24;

const lightBackgroundTokens = {
  gridLine: '#80808012',
  gradientStart: '#f1f5f9',
  gradientMiddle: '#f8fafc',
  gradientEnd: '#f1f5f9',
} as const;

const darkBackgroundTokens = {
  gridLine: '#ffffff0a',
  gradientStart: '#0f172a',
  gradientMiddle: '#1e293b',
  gradientEnd: '#0f172a',
} as const;

export type AppGridBackgroundProps = {
  children: React.ReactNode;
  /** Optional outer container style. */
  style?: StyleProp<ViewStyle>;
  /** Optional style for the foreground content layer. */
  contentStyle?: StyleProp<ViewStyle>;
};

/**
 * Full-screen graph-paper background for mobile, matching the shared web and practitioner shell.
 *
 * @param props - Optional styles plus the foreground subtree rendered above the SVG background.
 * @returns Themed background wrapper for mobile screens and modal surfaces.
 */
export function AppGridBackground({
  children,
  style,
  contentStyle,
}: AppGridBackgroundProps) {
  const { colorScheme, colors } = useAppTheme();
  const tokens =
    colorScheme === 'dark' ? darkBackgroundTokens : lightBackgroundTokens;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }, style]}>
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.background}
      >
        <Svg width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="app-grid-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor={tokens.gradientStart} />
              <Stop offset="45%" stopColor={tokens.gradientMiddle} />
              <Stop offset="100%" stopColor={tokens.gradientEnd} />
            </LinearGradient>
            <Pattern
              id="app-grid-pattern"
              patternUnits="userSpaceOnUse"
              width={GRID_TILE_WIDTH}
              height={GRID_TILE_HEIGHT}
            >
              <Path
                d={`M ${GRID_TILE_WIDTH} 0 L 0 0 0 ${GRID_TILE_HEIGHT}`}
                fill="none"
                stroke={tokens.gridLine}
                strokeWidth={1}
              />
            </Pattern>
          </Defs>

          <Rect x="0" y="0" width="100%" height="100%" fill="url(#app-grid-gradient)" />
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#app-grid-pattern)" />
        </Svg>
      </View>

      <View style={[styles.content, contentStyle]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  background: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    flex: 1,
  },
});
