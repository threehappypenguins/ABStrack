import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

/**
 * Dedicated port for Playwright’s `webServer` so local runs do not accidentally reuse
 * whatever is already bound to :3000 (common default for other stacks). Override with
 * `PLAYWRIGHT_WEB_PORT` if needed.
 */
const localWebPort = process.env['PLAYWRIGHT_WEB_PORT'] ?? '4310';
const localBaseURL = `http://localhost:${localWebPort}`;
/** When set (e.g. deployed preview), tests hit this origin and `webServer` is not started. */
const isRemote = Boolean(process.env['BASE_URL']);
const baseURL = process.env['BASE_URL'] || localBaseURL;

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 *
 * Timeouts are generous: the first request to `next dev` can spend a long time compiling.
 */
export default defineConfig({
  ...nxE2EPreset(__filename, { testDir: './src' }),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL,
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },
  /* Local runs only: remote `BASE_URL` implies a deployed target — do not start `next dev`. */
  ...(isRemote
    ? {}
    : {
        webServer: {
          // Pass --port on the CLI (same pattern as practitioner-e2e). Relying only on
          // PORT via env is fine for Next, but if a stray `next` already holds :3000,
          // an unflagged `nx run …:dev` can prompt/hang under Playwright with no output.
          command: `pnpm exec nx run @abstrack/web:dev -- --port ${localWebPort}`,
          url: localBaseURL,
          reuseExistingServer: !process.env.CI,
          cwd: workspaceRoot,
          timeout: 180_000,
          env: {
            PORT: localWebPort,
          },
        },
      }),
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    // Uncomment for mobile browsers support
    /* {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    }, */

    // Uncomment for branded browsers
    /* {
      name: 'Microsoft Edge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
    {
      name: 'Google Chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    } */
  ],
});
