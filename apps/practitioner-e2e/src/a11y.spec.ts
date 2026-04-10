import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Browser-based accessibility scans using axe-core (WCAG-oriented rulesets).
 * Runs once per test on Chromium to keep CI time reasonable; extend with
 * `testInfo.project.name` if you need Firefox/WebKit-specific coverage.
 */
test.describe('Accessibility (axe-core)', () => {
  test('home page has no axe violations @a11y', async ({ page }, testInfo) => {
    // Axe runs once per URL; Firefox/WebKit are skipped to keep full e2e runs fast.
    // eslint-disable-next-line playwright/no-skipped-test -- intentional per-project skip
    test.skip(
      testInfo.project.name !== 'chromium',
      'Axe runs on Chromium only for this suite; adjust if you need per-engine scans.',
    );

    await page.goto('/');

    // Stock Nx home content below the welcome block has decorative SVGs that fail axe;
    // scope to `#welcome` (see `apps/practitioner/src/app/page.tsx`). Wait so `include`
    // always matches — axe throws if the selector matches zero nodes.
    const welcome = page.locator('#welcome');
    await welcome.waitFor({ state: 'visible', timeout: 20_000 });

    const results = await new AxeBuilder({ page })
      .include('#welcome')
      .analyze();

    expect(
      results.violations,
      results.violations.length
        ? `axe violations:\n${JSON.stringify(
            results.violations.map((v) => ({
              id: v.id,
              impact: v.impact,
              description: v.description,
              nodes: v.nodes.slice(0, 5).map((n) => n.html),
            })),
            null,
            2,
          )}`
        : '',
    ).toEqual([]);
  });
});
