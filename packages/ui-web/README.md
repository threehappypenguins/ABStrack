# @abstrack/ui-web

Shared **web-only** UI built on [shadcn/ui](https://ui.shadcn.com/docs/components/radix/sidebar) (Radix + Tailwind). Used by `@abstrack/web` and `@abstrack/practitioner`.

## Theming

Semantic Tailwind tokens (`bg-sidebar`, `text-foreground`, etc.) map to ABStrack `--app-*` CSS variables via `tailwind-shadcn-preset.cjs` (CommonJS; this package is ESM). Each Next app must:

1. `presets: [require('../../packages/ui-web/tailwind-shadcn-preset.cjs')]`
2. `plugins: [require('tailwindcss-animate')]`
3. Include `packages/ui-web/src/**/*` in `content`

Dark mode follows `html.dark` (same as the apps’ theme toggle).

**Chrome tokens** (keep in sync in `apps/web/src/app/global.css` and `apps/practitioner/src/app/global.css`):

| Token                 | Light                    | Dark                  |
| --------------------- | ------------------------ | --------------------- |
| `--app-header-bg`     | `rgba(255,255,255,0.92)` | `rgba(15,23,42,0.92)` |
| `--app-sidebar-bg`    | `rgba(255,255,255,0.94)` | `rgba(15,23,42,0.94)` |
| `--app-header-border` | `rgba(226,232,240,0.95)` | `rgba(51,65,85,0.95)` |

The main column uses the `app-grid-background` class (defined in each app’s `global.css`) so the grid-paper viewport pattern is not covered by shadcn `bg-background` utilities.

The sidebar panel uses `--app-sidebar-bg` with `backdrop-blur-sm`. Grid lines are very faint in light mode (`#80808012`), so only a subtle hint shows through even at 94% opacity — that is expected, not a broken token.

## App side navigation

- `AppSideNav` — menu items + brand + optional footer
- `AppShellWithSideNav` — `SidebarProvider` + inset main column

Pass the host app’s `Link` component so routing stays in Next.js.

## Adding shadcn components

From the repo root (adjust style if the registry changes):

```bash
cd packages/ui-web
pnpm dlx shadcn@latest add <component> -y
```

Fix imports to use `.js` extensions and `../lib/utils.js` paths for NodeNext resolution, then export from `src/index.ts` if needed.
