// const { createGlobPatternsForDependencies } = require('@nx/next/tailwind');

// The above utility import will not work if you are using Next.js' --turbo.
// Instead you will have to manually add the dependent paths to be included.
// For example
// ../libs/buttons/**/*.{ts,tsx,js,jsx,html}',                 <--- Adding a shared lib
// !../libs/buttons/**/*.{stories,spec}.{ts,tsx,js,jsx,html}', <--- Skip adding spec/stories files from shared lib

// If you are **not** using `--turbo` you can uncomment both lines 1 & 19.
// A discussion of the issue can be found: https://github.com/nrwl/nx/issues/26510

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './{src,pages,components,app}/**/*.{ts,tsx,js,jsx,html}',
    '!./{src,pages,components,app}/**/*.{stories,spec}.{ts,tsx,js,jsx,html}',
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
        /** Semantic tokens (see global.css `:root` / `.dark`) */
        app: {
          bg: 'var(--app-bg)',
          surface: 'var(--app-surface)',
          border: 'var(--app-border)',
          muted: 'var(--app-muted)',
          ink: 'var(--app-ink)',
          primary: 'var(--app-primary)',
          'primary-soft': 'var(--app-primary-soft)',
          ring: 'var(--app-ring)',
        },
      },
      ringOffsetColor: {
        app: 'var(--app-bg)',
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
