import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

/**
 * Port 3001 avoids clashing with `@abstrack/web` (3000) when `pnpm a11y:e2e` runs both
 * suites sequentially — otherwise Playwright can reuse the wrong dev server.
 */
const practitionerDevPort = 3001;
const baseURL =
  process.env['BASE_URL'] || `http://localhost:${practitionerDevPort}`;

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
  /* Run your local dev server before starting the tests */
  webServer: {
    command: `pnpm exec nx run @abstrack/practitioner:dev -- --port ${practitionerDevPort}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    cwd: workspaceRoot,
    timeout: 180_000,
  },
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
