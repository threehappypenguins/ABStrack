/**
 * Maps shadcn/ui semantic Tailwind tokens to ABStrack `--app-*` theme channels.
 * Import in app `tailwind.config.js` via `presets` and add `tailwindcss-animate` to `plugins`.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        border: 'rgb(var(--app-border) / <alpha-value>)',
        input: 'rgb(var(--app-border) / <alpha-value>)',
        ring: 'rgb(var(--app-ring) / <alpha-value>)',
        background: 'rgb(var(--app-bg) / <alpha-value>)',
        foreground: 'rgb(var(--app-ink) / <alpha-value>)',
        primary: {
          DEFAULT: 'rgb(var(--app-primary) / <alpha-value>)',
          foreground: 'rgb(var(--app-surface) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'rgb(var(--app-surface) / <alpha-value>)',
          foreground: 'rgb(var(--app-ink) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'rgb(220 38 38 / <alpha-value>)',
          foreground: 'rgb(255 255 255 / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'rgb(var(--app-muted) / <alpha-value>)',
          foreground: 'rgb(var(--app-ink) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--app-primary-soft) / <alpha-value>)',
          foreground: 'rgb(var(--app-ink) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'rgb(var(--app-surface) / <alpha-value>)',
          foreground: 'rgb(var(--app-ink) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'rgb(var(--app-surface) / <alpha-value>)',
          foreground: 'rgb(var(--app-ink) / <alpha-value>)',
        },
        sidebar: {
          DEFAULT:
            'var(--app-sidebar-bg, rgb(var(--app-surface) / <alpha-value>))',
          foreground: 'rgb(var(--app-ink) / <alpha-value>)',
          primary: 'rgb(var(--app-primary) / <alpha-value>)',
          'primary-foreground': 'rgb(var(--app-surface) / <alpha-value>)',
          accent: 'rgb(var(--app-primary-soft) / <alpha-value>)',
          'accent-foreground': 'rgb(var(--app-ink) / <alpha-value>)',
          border: 'rgb(var(--app-border) / <alpha-value>)',
          ring: 'rgb(var(--app-ring) / <alpha-value>)',
        },
      },
    },
  },
};
