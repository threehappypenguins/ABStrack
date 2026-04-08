/**
 * Default and high-contrast palettes for shared primitives.
 * Values favor WCAG-friendly contrast for body text on surfaces.
 */
export type UiPalette = {
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  border: string;
  focusRing: string;
  primaryFill: string;
  primaryText: string;
  dangerFill: string;
  dangerText: string;
};

export const defaultPalette: UiPalette = {
  background: '#fafafa',
  surface: '#ffffff',
  text: '#0a0a0a',
  mutedText: '#525252',
  border: '#d4d4d4',
  focusRing: '#2563eb',
  primaryFill: '#1d4ed8',
  primaryText: '#ffffff',
  dangerFill: '#b91c1c',
  dangerText: '#ffffff',
};

export const highContrastPalette: UiPalette = {
  background: '#000000',
  surface: '#000000',
  text: '#ffffff',
  mutedText: '#ffffff',
  border: '#ffffff',
  focusRing: '#ffff00',
  primaryFill: '#ffffff',
  primaryText: '#000000',
  dangerFill: '#ffffff',
  dangerText: '#000000',
};
