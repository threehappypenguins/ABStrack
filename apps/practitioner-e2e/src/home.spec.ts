import { test, expect } from '@playwright/test';

test('unauthenticated landing shows practitioner heading', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('h1')).toContainText('ABStrack Practitioner');
});

test('unauthenticated patients route shows sign-in gate', async ({ page }) => {
  await page.goto('/patients');

  await expect(
    page.getByRole('heading', { name: /Sign in required/i }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Go to sign in/i }),
  ).toBeVisible();
});
