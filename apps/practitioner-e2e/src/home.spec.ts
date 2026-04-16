import { test, expect } from '@playwright/test';

test('unauthenticated landing shows practitioner heading', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('h1')).toContainText('ABStrack Practitioner');
});
