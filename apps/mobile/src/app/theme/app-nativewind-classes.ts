/**
 * Semantic NativeWind `className` fragments: **explicit light + dark** (`dark:`) per
 * {@link https://www.nativewind.dev/docs/core-concepts/differences | NativeWind}.
 * Tokens map to `colors.app.*` / `colors.app.*-dark` in `tailwind.config.js`.
 */
export const nw = {
  screenBg: 'bg-app-bg dark:bg-app-bg-dark',
  card: 'border border-app-border bg-app-surface dark:border-app-border-dark dark:bg-app-surface-dark',
  cardShadow: 'shadow-soft dark:shadow-soft-dark',
  textInk: 'text-app-ink dark:text-app-ink-dark',
  textMuted: 'text-app-muted dark:text-app-muted-dark',
  textError: 'text-app-error dark:text-app-error-dark',
  textInfo: 'text-app-info dark:text-app-info-dark',
  textPrimary: 'text-app-primary dark:text-app-primary-dark',
  textOnPrimary: 'text-app-on-primary dark:text-app-on-primary-dark',
  btnPrimary: 'bg-app-primary dark:bg-app-primary-dark',
  btnSecondary:
    'border border-app-primary bg-app-surface dark:border-app-primary-dark dark:bg-app-surface-dark',
  input:
    'border border-app-border bg-app-surface text-app-ink placeholder:text-app-input-placeholder dark:border-app-border-dark dark:bg-app-surface-dark dark:text-app-ink-dark dark:placeholder:text-app-input-placeholder-dark',
  healthSuccessPanel:
    'border border-app-health-success-border bg-app-health-success-bg dark:border-app-health-success-border-dark dark:bg-app-health-success-bg-dark',
  healthFailurePanel:
    'border border-app-health-failure-border bg-app-health-failure-bg dark:border-app-health-failure-border-dark dark:bg-app-health-failure-bg-dark',
  healthSuccessTitle:
    'text-app-health-success-title dark:text-app-health-success-title-dark',
  healthFailureTitle:
    'text-app-health-failure-title dark:text-app-health-failure-title-dark',
  healthSuccessBody:
    'text-app-health-success-body dark:text-app-health-success-body-dark',
  healthFailureBody:
    'text-app-health-failure-body dark:text-app-health-failure-body-dark',
} as const;
