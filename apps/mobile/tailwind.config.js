/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.js', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        /**
         * Semantic tokens aligned with `apps/web` (`global.css` / `tailwind.config.js`).
         * Prefer `useAppTheme()` + StyleSheet for RN screens; use these for `className` where useful.
         */
        app: {
          bg: '#f4f7fb',
          surface: '#ffffff',
          border: '#e2e8f0',
          muted: '#64748b',
          ink: '#0f172a',
          primary: '#1d4ed8',
          'primary-soft': '#dbeafe',
          ring: '#2563eb',
        },
      },
    },
  },
  plugins: [],
};
