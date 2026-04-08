/**
 * Accessibility-related layout constants shared by `@abstrack/ui` primitives.
 */

/**
 * Minimum recommended touch target size in density-independent points (dp),
 * aligned with common platform guidance (e.g. Apple HIG) and WCAG-adjacent practice for motor accessibility.
 *
 * @see https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
 */
export const MIN_TOUCH_TARGET_DP = 44;

/**
 * Larger default used where extra margin reduces mis-taps (primary actions, toolbars).
 */
export const COMFORTABLE_TOUCH_TARGET_DP = 48;

/**
 * Minimum touch-target edge length in **density-independent points (dp)**, or `false` to skip
 * enforcing a minimum (only when surrounding layout guarantees an adequate hit area).
 * Common values include {@link MIN_TOUCH_TARGET_DP} and {@link COMFORTABLE_TOUCH_TARGET_DP}; larger
 * values (e.g. 56) are valid when product guidance requires them.
 */
export type MinimumTouchTargetDp = number | false;

/**
 * Preset for {@link MIN_TOUCH_TARGET_DP} vs {@link COMFORTABLE_TOUCH_TARGET_DP}.
 */
export type TouchTargetPreset = 'minimum' | 'comfortable';

/**
 * Resolves a preset to a numeric minimum size in dp.
 *
 * @param preset - Which preset to use.
 * @returns Minimum edge length in dp.
 */
export function touchTargetDp(preset: TouchTargetPreset): number {
  return preset === 'comfortable'
    ? COMFORTABLE_TOUCH_TARGET_DP
    : MIN_TOUCH_TARGET_DP;
}
