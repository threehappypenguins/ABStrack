import { test, expect } from '@playwright/test';

test('unauthenticated root redirects to practitioner login', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole('heading', { name: 'Practitioner login' }),
  ).toBeVisible();
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
