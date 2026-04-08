import type { ReactNode } from 'react';
import { useMemo } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type ViewStyle,
} from 'react-native';
import { MIN_TOUCH_TARGET_DP } from './constants.js';
import { useFocusRing } from './hooks/useFocusRing.js';
import { defaultPalette, highContrastPalette, type UiPalette } from './styles/theme.js';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

/**
 * Minimum touch target size enforced by default. Pass `false` only when an equivalent
 * hit region is guaranteed by surrounding layout (document in app code).
 */
export type TouchTargetMinimum = typeof MIN_TOUCH_TARGET_DP | 48 | false;

export type ButtonProps = Omit<
  PressableProps,
  'children' | 'style' | 'accessibilityRole'
> & {
  /**
   * Button content. String or number children become the default `accessibilityLabel`.
   * For other React nodes, set `accessibilityLabel` yourself or rely on labeled child content
   * (do not pass an empty `accessibilityLabel`).
   */
  children: ReactNode;
  /** Visual style variant. */
  variant?: ButtonVariant;
  /**
   * Enforces a minimum interactive size in dp on both axes (WCAG-friendly default).
   * @default `44`
   */
  minimumTouchTarget?: TouchTargetMinimum;
  /** When `true` or when the user prefers high contrast, use stronger borders and fills. */
  highContrast?: boolean;
  /** Optional extra style for the outer pressable (supports Pressable style callbacks). */
  style?: PressableProps['style'];
};

function resolvePalette(highContrast: boolean | undefined): UiPalette {
  return highContrast ? highContrastPalette : defaultPalette;
}

function variantColors(
  variant: ButtonVariant,
  palette: UiPalette,
  pressed: boolean,
  disabled: boolean,
): { container: ViewStyle; label: { color: string } } {
  const opacity = disabled ? 0.5 : pressed ? 0.92 : 1;
  switch (variant) {
    case 'primary':
      return {
        container: {
          backgroundColor: palette.primaryFill,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.primaryFill,
          opacity,
        },
        label: { color: palette.primaryText },
      };
    case 'danger':
      return {
        container: {
          backgroundColor: palette.dangerFill,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.dangerFill,
          opacity,
        },
        label: { color: palette.dangerText },
      };
    case 'ghost':
      return {
        container: {
          backgroundColor: 'transparent',
          borderWidth: 0,
          opacity,
        },
        label: { color: palette.text },
      };
    case 'secondary':
    default:
      return {
        container: {
          backgroundColor: palette.surface,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.border,
          opacity,
        },
        label: { color: palette.text },
      };
  }
}

/**
 * Resolves `accessibilityLabel` for the pressable: explicit label wins; string/number
 * children supply a default; otherwise returns `undefined` so the platform can derive
 * a name from descendants (never forces an empty label).
 */
function resolveButtonAccessibilityLabel(
  children: ReactNode,
  accessibilityLabel: string | undefined,
): string | undefined {
  if (accessibilityLabel !== undefined) {
    return accessibilityLabel.trim() === '' ? undefined : accessibilityLabel;
  }
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children);
  }
  return undefined;
}

/**
 * Accessible pressable button with a minimum touch target, visible focus ring on web,
 * and optional high-contrast palette.
 *
 * @param props - Button props.
 * @returns Pressable button element.
 */
export function Button({
  children,
  variant = 'primary',
  minimumTouchTarget = MIN_TOUCH_TARGET_DP,
  highContrast = false,
  disabled,
  accessibilityLabel,
  style,
  onPress,
  onFocus: onFocusProp,
  onBlur: onBlurProp,
  ...rest
}: ButtonProps) {
  const { focused, onFocus, onBlur } = useFocusRing();
  const palette = resolvePalette(highContrast);

  const minSizeStyle = useMemo<ViewStyle | undefined>(() => {
    if (minimumTouchTarget === false) {
      return undefined;
    }
    return {
      minWidth: minimumTouchTarget,
      minHeight: minimumTouchTarget,
    };
  }, [minimumTouchTarget]);

  const resolvedAccessibilityLabel = resolveButtonAccessibilityLabel(
    children,
    accessibilityLabel,
  );

  return (
    <Pressable
      {...rest}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityLabel={resolvedAccessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      onFocus={(e) => {
        onFocus(e);
        onFocusProp?.(e);
      }}
      onBlur={(e) => {
        onBlur(e);
        onBlurProp?.(e);
      }}
      style={(state) => {
        const { container } = variantColors(
          variant,
          palette,
          state.pressed,
          !!disabled,
        );
        const focusStyle: ViewStyle =
          Platform.OS === 'web' && focused
            ? {
                outlineStyle: 'solid',
                outlineWidth: 2,
                outlineColor: palette.focusRing,
              }
            : {};
        return [
          styles.base,
          minSizeStyle,
          container,
          focusStyle,
          typeof style === 'function' ? style(state) : style,
        ];
      }}
    >
      {({ pressed }) => {
        const { label } = variantColors(variant, palette, pressed, !!disabled);
        if (typeof children === 'string' || typeof children === 'number') {
          return <Text style={[styles.label, label]}>{children}</Text>;
        }
        return children;
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});
