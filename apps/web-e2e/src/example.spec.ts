import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('/');

  // Default e2e run is signed-out: marketing hero + root/child metadata still include the product name.
  await expect(page).toHaveTitle(/ABStrack/);
  await expect(page.locator('h1')).toContainText('Auto-Brewery Syndrome');
});
