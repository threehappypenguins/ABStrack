/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.js', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  /**
   * `media` enables Tailwind `dark:` utilities from OS preference. Semantic `app.*` colors do not
   * rely on `dark:`—they use CSS variables in `global.css` that already switch under
   * `prefers-color-scheme: dark` (parallel to web’s `html.dark` + class strategy).
   */
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        /**
         * Semantic tokens: RGB channels live in `global.css` (`:root` + dark media query).
         * Opacity modifiers use `rgb(var(--app-*) / <alpha-value>)` like web.
         * Prefer `useAppTheme()` + StyleSheet for screens; use `className` utilities where NativeWind fits.
         */
        app: {
          bg: 'rgb(var(--app-bg) / <alpha-value>)',
          surface: 'rgb(var(--app-surface) / <alpha-value>)',
          border: 'rgb(var(--app-border) / <alpha-value>)',
          muted: 'rgb(var(--app-muted) / <alpha-value>)',
          ink: 'rgb(var(--app-ink) / <alpha-value>)',
          primary: 'rgb(var(--app-primary) / <alpha-value>)',
          'primary-soft': 'rgb(var(--app-primary-soft) / <alpha-value>)',
          ring: 'rgb(var(--app-ring) / <alpha-value>)',
        },
      },
      ringOffsetColor: {
        app: {
          bg: 'rgb(var(--app-bg) / <alpha-value>)',
        },
      },
      boxShadow: {
        soft: 'var(--app-shadow-soft)',
        header: 'var(--app-shadow-header)',
      },
      backgroundImage: {
        'app-gradient': 'var(--app-gradient)',
      },
    },
  },
  plugins: [],
};
