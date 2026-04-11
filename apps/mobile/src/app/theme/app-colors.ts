/**
 * Semantic colors for React Navigation and other non-`className` APIs; align with web
 * (`apps/web/src/app/global.css`).
 *
 * **NativeWind** resolves `bg-app-*` and `dark:` utilities from `theme.extend.colors.app` in
 * `apps/mobile/tailwind.config.js` (static `rgb()` values) — that file is the RN runtime source of truth.
 * `apps/mobile/global.css` keeps matching `--app-*` channels for web parity and tooling; update both when
 * tokens change.
 *
 * Health panel fills match solid `--app-health-*-bg` channels (no baked-in alpha). For translucent overlays,
 * apply opacity on the view or use Tailwind `/opacity` on web — same idea as `primarySoft`.
 */
export type AppThemeColors = {
  bg: string;
  surface: string;
  border: string;
  muted: string;
  ink: string;
  primary: string;
  /**
   * Opaque fill aligned with `app.primary-soft` / `app.primary-soft-dark` in `tailwind.config.js` and
   * `--app-primary-soft` in `global.css`. For translucent chips or overlays, set opacity on the view or
   * use a separate alpha at the call site (web uses utilities like `bg-app-primary-soft/28`).
   */
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

/** Dark appearance: matches `theme.colors.app.*-dark` in `tailwind.config.js` and dark `--app-*` in `global.css`. */
export const darkAppColors: AppThemeColors = {
  bg: '#0f172a',
  surface: '#1e293b',
  border: '#334155',
  muted: '#94a3b8',
  ink: '#f1f5f9',
  primary: '#60a5fa',
  primarySoft: '#2563eb',
  primaryOnSoft: '#93c5fd',
  onPrimary: '#0f172a',
  error: '#f87171',
  info: '#60a5fa',
  /** Dimmer than {@link ink} titles; between previous slate-300 and full {@link muted}. */
  inputPlaceholder: '#9ca3af',
  shadow: '#000000',
  shadowOpacity: 0.35,
  healthSuccessBg: '#166534',
  healthSuccessBorder: '#22c55e',
  healthSuccessTitle: '#86efac',
  healthSuccessBody: '#bbf7d0',
  healthFailureBg: '#b91c1c',
  healthFailureBorder: '#f87171',
  healthFailureTitle: '#fecaca',
  healthFailureBody: '#fecaca',
};
