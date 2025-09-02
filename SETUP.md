# Setup for ABStrack Development

## Prerequisites

- Node.js 18+ installed
- [Supabase Account](https://supabase.com/)
- Git installed

## General Setup

### Step 1: Clone the Repository

```bash
git clone git@github.com:threehappypenguins/ABStrack.git
cd ABStrack
```

### Step 2: Install Dependencies

```bash
npm install
# or
yarn
```

If you have installation issues with npm, try `npm install --legacy-peer-deps`.

This will install Supabase CLI, Expo and everything you need that's listed as a dev dependency.

## Supabase

### Step 3: Connect to Supabase

1. Create a project
2. Open the project, and observe the URL; for example: `https://supabase.com/dashboard/project/asdfghjklqwerty`
3. Copy `asdfghjklqwerty` (or whatever it is in the URL) and paste the project ref in a notepad
4. Navigate to Project Settings > Data API
5. Copy the URL and paste in a notepad
6. Navigate to Project Settings > API Keys
7. Copy the `anon` `public` key and paste in a notepad
8. Navigate to Authentication > URL Configuration
9. Set the Site URL to: `http://localhost:8081`
10. Add Redirect URLs:
    - `http://localhost:8081/**`
    - `exp://localhost:19000/**` (for Expo)

Copy the environment example file:
   ```bash
   cp .env.example .env.local
   ```

Paste your URL and anon public keys in `.env.local`.

# Build tables from local project

```bash
npx supabase login
npx supabase link --project-ref your_project_ref_here
```

# Run the migration

This will create tables in your remote supabase.

```bash
npx supabase db push
```

### Step 4: Managing Migrations

If you run into problems applying migrations, you can delete all your data and start fresh with:

```bash
npx supabase db reset --linked
```

### Step 5: Run Expo

```bash
npx expo start --clear
```

This will start a local version of the web app, as well as produce a QR code that can be used with the Expo mobile app to run the app on a mobile device.

### Step 3: Access the Website

Visit [http://localhost:8081/](http://localhost:8081/) to view the web app.<br>
Scan the QR code with a mobile device (using the Expo app) to view the mobile app.