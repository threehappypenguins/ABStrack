# Repository instructions for AI coding agents

## Never run Git or Supabase database commands on Sarah’s behalf

**Do not** run **`git commit`**, **`git push`**, **`git merge`**, or any other **Git** command that updates history or remotes. **Do not** run **`pnpm dlx supabase db push`**, **`supabase migration repair`**, or any command that **applies migrations** or **mutates migration history** on her linked/cloud project. **Do not** perform **releases**, **tags**, or **PR merges** for her.

Sarah alone decides when schema hits cloud, when history is rewritten, and when work is published. **Instruct her** to run the exact commands from **[docs/SUPABASE_CLOUD_DEVELOPER.md](docs/SUPABASE_CLOUD_DEVELOPER.md)** (or Git docs) when something must happen in **her** terminal or on **GitHub**—do not execute those steps yourself unless she **explicitly** asks you to run a **specific** command in chat.

## Supabase: cloud + CLI on Sarah’s machine for migrations

**Sarah uses Supabase Cloud.** **GitHub Actions** runs **`supabase db push`** when code merges to **`main`** (backstop: `main` and cloud stay aligned).

Details: **[docs/SUPABASE_CLOUD_DEVELOPER.md](docs/SUPABASE_CLOUD_DEVELOPER.md)**.

- **`supabase db reset`** is **local Docker only** (or CI-only), not cloud.
- **`database.types.ts` is not auto-committed** by any bot.

### Correct flow for migrations and database.types.ts (agents: follow this)

1. **Change `supabase/migrations/*.sql` only.** Do **not** edit **`packages/supabase/src/lib/database.types.ts`** to “match” new tables/columns or to fix TypeScript before generation—that file is **only** the output of **`supabase gen types`** (see step 4).
2. **Push and finish reviews** (Copilot, humans). Revise the **same migration file(s)** as needed. **Do not create a new migration file during review iterations** unless Sarah explicitly asks. Assume migrations are **not pushed to cloud yet** until Sarah says she is done reviewing and ready. Still **do not** hand-edit `database.types.ts`.
3. **After reviews are done**, Sarah runs **`db push`** and **`gen types typescript --linked`** in **her** terminal (see commands below). **`--linked` reads Supabase Cloud**; it does **not** read migration files from git, so types cannot honestly reflect new SQL until it is applied to the linked project.
4. **Regenerated `database.types.ts`** is committed **with** the migration(s), then the PR merges.

**Never hand-edit `database.types.ts`:** no adding columns, no deleting `Insert`/`Update` keys, no comments inside the `Database` type. CI diffs it to **`gen types --local`**; manual edits cause failures and confusion. For stricter write shapes, use **`@abstrack/types`** and wrappers such as **`packages/supabase/src/lib/health-markers-db-write-types.ts`**.

If app code needs new DB fields before Sarah regenerates types, use those wrappers or narrow types in **non-generated** files—**not** a patched `database.types.ts`.

### When you MUST tell Sarah to run commands (migrations / types)

**Do not** tell her to **`db push`** or run **`--linked`** while she is still in review unless she says she is ready.

When schema work is settled, tell her to run **from the repo root** (after `login` + `link`):

```bash
pnpm dlx supabase db push
pnpm dlx supabase gen types typescript --linked --schema public > packages/supabase/src/lib/database.types.ts
pnpm exec prettier --write packages/supabase/src/lib/database.types.ts
```

(`database.types.ts` uses **`prettier.database-types.json`** via `.prettierrc.cjs` — see **SUPABASE_CLOUD_DEVELOPER.md**.)

**Sarah commits** migration(s) + generated **`database.types.ts`** (the agent does not commit). Order: **`db push`** before **`gen types --linked`**.

## Tell Sarah when she must run something (general)

If a step needs **her** terminal, **dashboard**, or **GitHub** settings, say so explicitly—do not imply it already ran.

## Before changing automation

Do **not** change `.github/workflows/*` deployment, permissions, or secrets without **asking Sarah first**.

## Naming and structure

Do **not** add **`week_`** (or other week-number-style prefixes) to **code, identifiers, or file/folder paths**. Use **feature- or domain-based** names instead (for example `page-states`, not `week4`).

## MCP servers (documentation and APIs)

This workspace has **MCP servers** (for example Context7 for library and framework docs, Nx, Supabase, Next.js devtools, and the in-editor browser). **Use them** to pull **current** documentation and API details instead of relying only on training data. That helps avoid **deprecated** patterns, outdated APIs, and wrong version-specific behavior.

## Accessibility & screen readers

ABStrack is **accessibility-first** (see **[docs/PRD.md](docs/PRD.md)**). Treat **screen reader**, **keyboard**, and **large-target** support as **default requirements** for interactive UI—not a polish pass at the end.

- **Conventions:** Follow **[docs/A11Y.md](docs/A11Y.md)** for live announcements, forms, dialogs, and charts.
- **User & practitioner web:** Root layouts mount `LiveAnnouncerProvider` (via `LiveAnnouncerRoot`). In client components, use **`useAnnounce()`** from **`@abstrack/ui/a11y-web`** (or the same exports from `@abstrack/ui` where the full package is already used) for transient status (polite vs assertive per `docs/A11Y.md`). Prefer **`@abstrack/ui/a11y-web`** in Next.js when you only need announcements, to avoid pulling the React Native–based UI barrel into server/client graphs unnecessarily.
- **Mobile:** Use **`announce()`** from `@abstrack/ui/native` for short spoken feedback; use **`accessibilityLabel`**, **`accessibilityRole`**, **`accessibilityState`**, and **`accessibilityLiveRegion`** (Android) as appropriate for persistent UI.
- **Semantics:** Prefer native HTML semantics and labels; use ARIA only when semantics are missing or insufficient. Do not rely on **color alone** for meaning.
- **Dynamic feedback:** Ensure important changes are available to assistive tech (live regions / `announce`), not only visually.
- **Charts:** Avoid visual-only insights; provide a **text summary** or structured alternative for chart data where the PRD calls for charts.
- **Verification:** When changing UI, keep **eslint** / **axe** checks green where they apply; call out **manual** screen reader smoke tests for new critical flows when automation cannot cover them.

## Documentation (Typedoc / JSDoc)

**Typedoc** is used for API documentation. Maintain it as you work:

- Every **exported** function, **public** component, **hook**, and **exported** type should have a **JSDoc** comment.
- Each comment should describe **purpose**, **parameters** (`@param` where applicable), and **return value** (`@returns` where applicable), following existing project conventions.
