/**
 * Semantic colors aligned with `apps/web/src/app/global.css` (`--app-*` RGB tokens).
 * Used for React Native `StyleSheet` theming; manual preference will plug into the same shape later.
 */
export type AppThemeColors = {
  bg: string;
  surface: string;
  border: string;
  muted: string;
  ink: string;
  primary: string;
  primarySoft: string;
  primaryOnSoft: string;
  onPrimary: string;
  error: string;
  info: string;
  /** TextInput placeholder: visible on `surface`, dimmer than {@link ink} labels. */
  inputPlaceholder: string;
  /** Shadow color for elevated cards (iOS). */
  shadow: string;
  shadowOpacity: number;
  healthSuccessBg: string;
  healthSuccessBorder: string;
  healthSuccessTitle: string;
  healthSuccessBody: string;
  healthFailureBg: string;
  healthFailureBorder: string;
  healthFailureTitle: string;
  healthFailureBody: string;
};

export const lightAppColors: AppThemeColors = {
  bg: '#f4f7fb',
  surface: '#ffffff',
  border: '#e2e8f0',
  muted: '#64748b',
  ink: '#0f172a',
  primary: '#1d4ed8',
  primarySoft: '#dbeafe',
  primaryOnSoft: '#1d4ed8',
  onPrimary: '#ffffff',
  error: '#b91c1c',
  info: '#1d4ed8',
  inputPlaceholder: '#64748b',
  shadow: '#0f172a',
  shadowOpacity: 0.08,
  healthSuccessBg: '#f0fdf4',
  healthSuccessBorder: '#16a34a',
  healthSuccessTitle: '#15803d',
  healthSuccessBody: '#166534',
  healthFailureBg: '#fef2f2',
  healthFailureBorder: '#dc2626',
  healthFailureTitle: '#991b1b',
  healthFailureBody: '#7f1d1d',
};

/** Mirrors `html.dark` in global.css. */
export const darkAppColors: AppThemeColors = {
  bg: '#0f172a',
  surface: '#1e293b',
  border: '#334155',
  muted: '#94a3b8',
  ink: '#f1f5f9',
  primary: '#60a5fa',
  primarySoft: 'rgba(37, 99, 235, 0.35)',
  primaryOnSoft: '#93c5fd',
  onPrimary: '#0f172a',
  error: '#f87171',
  info: '#60a5fa',
  /** Dimmer than {@link ink} titles; between previous slate-300 and full {@link muted}. */
  inputPlaceholder: '#9ca3af',
  shadow: '#000000',
  shadowOpacity: 0.35,
  healthSuccessBg: 'rgba(22, 101, 52, 0.35)',
  healthSuccessBorder: '#22c55e',
  healthSuccessTitle: '#86efac',
  healthSuccessBody: '#bbf7d0',
  healthFailureBg: 'rgba(185, 28, 28, 0.35)',
  healthFailureBorder: '#f87171',
  healthFailureTitle: '#fecaca',
  healthFailureBody: '#fecaca',
};
