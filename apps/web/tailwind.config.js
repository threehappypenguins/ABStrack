// const { createGlobPatternsForDependencies } = require('@nx/next/tailwind');

// The above utility import will not work if you are using Next.js' --turbo.
// Instead you will have to manually add the dependent paths to be included.
// For example
// ../libs/buttons/**/*.{ts,tsx,js,jsx,html}',                 <--- Adding a shared lib
// !../libs/buttons/**/*.{stories,spec}.{ts,tsx,js,jsx,html}', <--- Skip adding spec/stories files from shared lib

// If you are **not** using `--turbo` you can uncomment both lines 1 & 19.
// A discussion of the issue can be found: https://github.com/nrwl/nx/issues/26510

const shadcnPreset = require('../../packages/ui-web/tailwind-shadcn-preset.cjs');

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  presets: [shadcnPreset],
  content: [
    './{src,pages,components,app}/**/*.{ts,tsx,js,jsx,html}',
    '!./{src,pages,components,app}/**/*.{stories,spec}.{ts,tsx,js,jsx,html}',
    '../../packages/ui/src/**/*.{ts,tsx}',
    '!../../packages/ui/src/**/*.{stories,spec}.{ts,tsx}',
    '../../packages/ui-web/src/**/*.{ts,tsx}',
    '!../../packages/ui-web/src/**/*.{stories,spec}.{ts,tsx}',
    //     ...createGlobPatternsForDependencies(__dirname)
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'var(--font-app-sans)',
          'ui-sans-serif',
          'system-ui',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      colors: {
        /** Semantic tokens: global.css holds R G B channels; opacity modifiers use /alpha */
        app: {
          bg: 'rgb(var(--app-bg) / <alpha-value>)',
          surface: 'rgb(var(--app-surface) / <alpha-value>)',
          border: 'rgb(var(--app-border) / <alpha-value>)',
          muted: 'rgb(var(--app-muted) / <alpha-value>)',
          ink: 'rgb(var(--app-ink) / <alpha-value>)',
          primary: 'rgb(var(--app-primary) / <alpha-value>)',
          'primary-solid': 'rgb(var(--app-primary-solid) / <alpha-value>)',
          'on-primary-solid':
            'rgb(var(--app-primary-on-solid) / <alpha-value>)',
          'primary-soft': 'rgb(var(--app-primary-soft) / <alpha-value>)',
          ring: 'rgb(var(--app-ring) / <alpha-value>)',
        },
      },
      /** Mirrors `colors.app.bg` so `ring-offset-app-bg` resolves (flat `app` would break nested keys). */
      ringOffsetColor: {
        app: {
          bg: 'rgb(var(--app-bg) / <alpha-value>)',
        },
      },
      boxShadow: {
        soft: 'var(--app-shadow-soft)',
        header: 'var(--app-shadow-header)',
        'sidebar-edge': 'var(--app-shadow-sidebar-edge)',
      },
      backgroundImage: {
        'app-gradient': 'var(--app-gradient)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
