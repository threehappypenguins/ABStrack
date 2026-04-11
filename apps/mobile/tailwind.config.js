/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.js', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  /**
   * `class` is required for {@link https://www.nativewind.dev/docs/core-concepts/dark-mode | NativeWind}
   * `colorScheme.set('light' | 'dark' | 'system')` (manual theme). Use explicit `dark:` pairs
   * (`text-app-ink dark:text-app-ink-dark`).
   *
   * RN: keep opacity core plugins off so colors compile to solid `rgb(... / 1)`.
   *
   * Light/dark channel values align with `global.css`.
   */
  darkMode: 'class',
  corePlugins: {
    backgroundOpacity: false,
    textOpacity: false,
    borderOpacity: false,
    ringOpacity: false,
    placeholderOpacity: false,
  },
  theme: {
    extend: {
      colors: {
        app: {
          bg: 'rgb(244 247 251 / <alpha-value>)',
          'bg-dark': 'rgb(15 23 42 / <alpha-value>)',
          surface: 'rgb(255 255 255 / <alpha-value>)',
          'surface-dark': 'rgb(30 41 59 / <alpha-value>)',
          border: 'rgb(226 232 240 / <alpha-value>)',
          'border-dark': 'rgb(51 65 85 / <alpha-value>)',
          muted: 'rgb(100 116 139 / <alpha-value>)',
          'muted-dark': 'rgb(148 163 184 / <alpha-value>)',
          ink: 'rgb(15 23 42 / <alpha-value>)',
          'ink-dark': 'rgb(241 245 249 / <alpha-value>)',
          primary: 'rgb(29 78 216 / <alpha-value>)',
          'primary-dark': 'rgb(96 165 250 / <alpha-value>)',
          'primary-soft': 'rgb(219 234 254 / <alpha-value>)',
          'primary-soft-dark': 'rgb(37 99 235 / <alpha-value>)',
          ring: 'rgb(37 99 235 / <alpha-value>)',
          'ring-dark': 'rgb(147 197 253 / <alpha-value>)',
          error: 'rgb(185 28 28 / <alpha-value>)',
          'error-dark': 'rgb(248 113 113 / <alpha-value>)',
          'on-primary': 'rgb(255 255 255 / <alpha-value>)',
          'on-primary-dark': 'rgb(15 23 42 / <alpha-value>)',
          info: 'rgb(29 78 216 / <alpha-value>)',
          'info-dark': 'rgb(96 165 250 / <alpha-value>)',
          'input-placeholder': 'rgb(100 116 139 / <alpha-value>)',
          'input-placeholder-dark': 'rgb(156 163 175 / <alpha-value>)',
          'health-success-bg': 'rgb(240 253 244 / <alpha-value>)',
          'health-success-bg-dark': 'rgb(22 101 52 / <alpha-value>)',
          'health-success-border': 'rgb(22 163 74 / <alpha-value>)',
          'health-success-border-dark': 'rgb(34 197 94 / <alpha-value>)',
          'health-success-title': 'rgb(21 128 61 / <alpha-value>)',
          'health-success-title-dark': 'rgb(134 239 172 / <alpha-value>)',
          'health-success-body': 'rgb(22 101 52 / <alpha-value>)',
          'health-success-body-dark': 'rgb(187 247 208 / <alpha-value>)',
          'health-failure-bg': 'rgb(254 242 242 / <alpha-value>)',
          'health-failure-bg-dark': 'rgb(185 28 28 / <alpha-value>)',
          'health-failure-border': 'rgb(220 38 38 / <alpha-value>)',
          'health-failure-border-dark': 'rgb(248 113 113 / <alpha-value>)',
          'health-failure-title': 'rgb(153 27 27 / <alpha-value>)',
          'health-failure-title-dark': 'rgb(254 202 202 / <alpha-value>)',
          'health-failure-body': 'rgb(127 29 29 / <alpha-value>)',
          'health-failure-body-dark': 'rgb(254 202 202 / <alpha-value>)',
        },
      },
      ringOffsetColor: {
        app: {
          bg: 'rgb(244 247 251 / <alpha-value>)',
          'bg-dark': 'rgb(15 23 42 / <alpha-value>)',
        },
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px -4px rgba(15, 23, 42, 0.08)',
        'soft-dark':
          '0 1px 2px rgba(0, 0, 0, 0.25), 0 8px 24px -4px rgba(0, 0, 0, 0.35)',
        header: '0 1px 0 rgba(15, 23, 42, 0.06)',
        'header-dark': '0 1px 0 rgba(0, 0, 0, 0.35)',
      },
      backgroundImage: {
        'app-gradient':
          'linear-gradient(180deg, #f1f5f9 0%, #f8fafc 45%, #f1f5f9 100%)',
        'app-gradient-dark':
          'linear-gradient(180deg, #0f172a 0%, #1e293b 45%, #0f172a 100%)',
      },
    },
  },
  plugins: [],
};
