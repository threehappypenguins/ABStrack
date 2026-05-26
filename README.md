# ABStrack

ABStrack is an open-source, privacy-first health tracking platform for people living with Auto-Brewery Syndrome (ABS). It is designed to help patients document episodes, symptoms, health markers, food intake, and media evidence, while giving caretakers and authorized healthcare practitioners access to the data they need.

This repository is an Nx monorepo containing the patient mobile app, supplementary user web app, practitioner web app, and shared packages.

## Product overview

- Patients and caretakers are mobile-first: `apps/mobile` is the primary experience.
- User web in `apps/web` supports supplementary patient and caretaker flows.
- Practitioners use the dedicated web app in `apps/practitioner`.
- Data is backed by Supabase, with PowerSync used for mobile offline replication.
- Accessibility is a core product requirement, especially for episode logging during cognitive impairment.

## Workspace layout

```text
ABStrack/
|- apps/
|  |- mobile/          # Expo / React Native app for patients and caretakers
|  |- web/             # Next.js user web app
|  |- practitioner/    # Next.js practitioner web app
|  |- web-e2e/         # Playwright tests for user web
|  `- practitioner-e2e/ # Playwright tests for practitioner web
|- packages/
|  |- supabase/        # Shared Supabase clients, auth helpers, typed queries
|  |- powersync/       # PowerSync sync config and helpers
|  |- types/           # Shared domain types
|  |- ui/              # Shared cross-platform UI components
|  `- ui-web/          # Shared web-only UI helpers/components
|- docs/               # Product, setup, accessibility, security, and roadmap docs
`- supabase/           # Migrations and Edge Functions
```

## Tech stack

- `Nx` + `pnpm` monorepo
- `Next.js` for the web apps
- `Expo` + `React Native` for mobile
- `Supabase` for auth, Postgres, storage, and Edge Functions
- `PowerSync` for offline-first mobile sync
- `Tailwind CSS` / `NativeWind` for styling

## Quick start

1. Install dependencies:

```bash
pnpm install --frozen-lockfile
```

2. Create local env files from the template and fill in real values:

```bash
cp .env.example apps/web/.env.local
cp .env.example apps/practitioner/.env.local
cp .env.example apps/mobile/.env
```

3. Start the apps you need:

```bash
pnpm web
pnpm practitioner
pnpm mobile
```

4. Run workspace checks:

```bash
pnpm validate
```

For the full setup process, environment variable details, Supabase CLI workflow, and mobile development notes, see [`docs/DEV_SETUP.md`](docs/DEV_SETUP.md).

## Documentation

- [`docs/PRD.md`](docs/PRD.md) - product requirements and architecture
- [`docs/DEV_SETUP.md`](docs/DEV_SETUP.md) - local development setup
- [`docs/SUPABASE_CLOUD_DEVELOPER.md`](docs/SUPABASE_CLOUD_DEVELOPER.md) - Supabase Cloud workflow, migrations, and type generation
- [`docs/A11Y.md`](docs/A11Y.md) - accessibility conventions and expectations
- [`docs/SECURITY_BASELINE.md`](docs/SECURITY_BASELINE.md) - security baseline and implementation notes
- [`docs/ROADMAP.md`](docs/ROADMAP.md) - development roadmap and milestones
- [`docs/CHARTS_VERIFICATION.md`](docs/CHARTS_VERIFICATION.md) - chart verification guidance
- [`docs/AUTH_CLAIM_CONTRACT.md`](docs/AUTH_CLAIM_CONTRACT.md) - auth/session claim expectations
- [`docs/EPISODE_DELETION_POLICY.md`](docs/EPISODE_DELETION_POLICY.md) - episode deletion rules

## Notes for contributors

- This repo uses current Supabase publishable and secret API keys, not legacy anon/service-role env names.
- Mobile development requires a development build or native run flow; do not rely on Expo Go for this app.
- Database schema changes should be made through `supabase/migrations/`, with the full workflow documented in [`docs/SUPABASE_CLOUD_DEVELOPER.md`](docs/SUPABASE_CLOUD_DEVELOPER.md).

## License

MIT
