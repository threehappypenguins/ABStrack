import { useId } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { MIN_TOUCH_TARGET_DP, type MinimumTouchTargetDp } from './constants.js';
import { useFocusRing } from './hooks/useFocusRing.js';
import { defaultPalette, highContrastPalette } from './styles/theme.js';

export type InputProps = Omit<TextInputProps, 'style'> & {
  /** Visible label; used for native `accessibilityLabel` and web `aria-labelledby` by default. */
  label: string;
  /** Optional hint below the field (plain text only; rendered in a `Text` node). */
  hint?: string | number;
  /**
   * Enforces a minimum height for the field in **dp** (see {@link MinimumTouchTargetDp}).
   * @default {@link MIN_TOUCH_TARGET_DP}
   */
  minimumTouchTarget?: MinimumTouchTargetDp;
  /** Stronger borders and text for high-contrast presentation. */
  highContrast?: boolean;
  /**
   * Stable id for the field (`TextInput` `nativeID`, DOM `id` on web). The visible label uses
   * `${inputId}-label` so web can wire `aria-labelledby` → label node without duplicating the string in `aria-label`.
   */
  inputId?: string;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
};

/**
 * Single-line text field with a visible label, focus ring on web, and minimum touch height.
 *
 * @param props - Input props.
 * @returns Labeled text input.
 */
export function Input({
  label,
  hint,
  minimumTouchTarget = MIN_TOUCH_TARGET_DP,
  highContrast = false,
  inputId: inputIdProp,
  accessibilityLabel: accessibilityLabelProp,
  style,
  containerStyle,
  editable,
  onFocus: onFocusProp,
  onBlur: onBlurProp,
  ...rest
}: InputProps) {
  const reactId = useId();
  const inputId = inputIdProp ?? `abstrack-input-${reactId.replace(/:/g, '')}`;
  const labelNativeId = `${inputId}-label`;
  const { focused, onFocus, onBlur } = useFocusRing();
  const palette = highContrast ? highContrastPalette : defaultPalette;

  const minHeightStyle =
    minimumTouchTarget === false
      ? undefined
      : { minHeight: Math.max(0, minimumTouchTarget) };

  const focusStyle: TextStyle =
    Platform.OS === 'web' && focused
      ? {
          outlineStyle: 'solid',
          outlineWidth: 2,
          outlineColor: palette.focusRing,
        }
      : {};

  const useWebLabelAssociation =
    Platform.OS === 'web' && accessibilityLabelProp === undefined;

  return (
    <View style={[styles.field, containerStyle]}>
      <Text
        nativeID={labelNativeId}
        {...(Platform.OS === 'web'
          ? { accessibilityRole: 'text' as const }
          : {})}
        style={[styles.label, { color: palette.text }]}
      >
        {label}
      </Text>
      <TextInput
        {...rest}
        nativeID={inputId}
        editable={editable}
        accessibilityLabel={
          useWebLabelAssociation ? undefined : (accessibilityLabelProp ?? label)
        }
        {...(useWebLabelAssociation
          ? ({ 'aria-labelledby': labelNativeId } as object)
          : {})}
        placeholderTextColor={rest.placeholderTextColor ?? palette.mutedText}
        onFocus={(e) => {
          onFocus();
          onFocusProp?.(e);
        }}
        onBlur={(e) => {
          onBlur();
          onBlurProp?.(e);
        }}
        style={[
          styles.input,
          minHeightStyle,
          {
            borderColor: palette.border,
            backgroundColor: palette.surface,
            color: palette.text,
          },
          focusStyle,
          style,
        ]}
      />
      {hint ? (
        <Text style={[styles.hint, { color: palette.mutedText }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: 6,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  hint: {
    fontSize: 14,
  },
});
