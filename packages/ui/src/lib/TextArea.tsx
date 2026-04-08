import type { ReactNode } from 'react';
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
import { MIN_TOUCH_TARGET_DP } from './constants.js';
import { useFocusRing } from './hooks/useFocusRing.js';
import { defaultPalette, highContrastPalette } from './styles/theme.js';

export type TextAreaProps = Omit<TextInputProps, 'style' | 'multiline'> & {
  /** Visible label; drives default `accessibilityLabel`. */
  label: string;
  hint?: ReactNode;
  /**
   * Minimum height of the multiline control in dp (also floored by touch-target guidance).
   * @default `120`
   */
  minHeight?: number;
  /**
   * Minimum interactive height in dp; combined with `minHeight` using `Math.max`.
   * @default `44`
   */
  minimumTouchTarget?: typeof MIN_TOUCH_TARGET_DP | 48 | false;
  highContrast?: boolean;
  inputId?: string;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
};

/**
 * Multiline text field with label, focus ring on web, and a comfortably tall default height.
 *
 * @param props - Text area props.
 * @returns Labeled multiline text input.
 */
export function TextArea({
  label,
  hint,
  minHeight = 120,
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
}: TextAreaProps) {
  const reactId = useId();
  const inputId = inputIdProp ?? `abstrack-textarea-${reactId.replace(/:/g, '')}`;
  const { focused, onFocus, onBlur } = useFocusRing();
  const palette = highContrast ? highContrastPalette : defaultPalette;

  const combinedMinHeight =
    minimumTouchTarget === false
      ? minHeight
      : Math.max(minHeight, minimumTouchTarget);

  const focusStyle: TextStyle =
    Platform.OS === 'web' && focused
      ? {
          outlineStyle: 'solid',
          outlineWidth: 2,
          outlineColor: palette.focusRing,
        }
      : {};

  return (
    <View style={[styles.field, containerStyle]}>
      <Text
        {...(Platform.OS === 'web'
          ? { accessibilityRole: 'text' as const }
          : {})}
        style={[styles.label, { color: palette.text }]}
      >
        {label}
      </Text>
      <TextInput
        {...rest}
        multiline
        nativeID={inputId}
        editable={editable}
        accessibilityLabel={accessibilityLabelProp ?? label}
        placeholderTextColor={rest.placeholderTextColor ?? palette.mutedText}
        textAlignVertical="top"
        onFocus={(e) => {
          onFocus(e);
          onFocusProp?.(e);
        }}
        onBlur={(e) => {
          onBlur(e);
          onBlurProp?.(e);
        }}
        style={[
          styles.input,
          { minHeight: combinedMinHeight },
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
