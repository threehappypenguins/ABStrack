import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('/');

  // Signed-out home: h1 is "ABStrack". Signed-in: "Welcome to ABStrack". Both include the product name.
  await expect(page.locator('h1')).toContainText('ABStrack');
});
