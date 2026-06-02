/**
 * Daily Learning UI 베타 (sign-in 우회 + 단순 렌더 확인)
 */
import { test, expect } from '@playwright/test';

test.describe('Daily Learning UI', () => {
  test('Daily page redirects to /login when unauthenticated (protected)', async ({ page }) => {
    await page.goto('/daily');
    await expect(page).toHaveURL(/login/, { timeout: 5_000 });
  });

  test('Progress page redirects to /login when unauthenticated', async ({ page }) => {
    await page.goto('/progress');
    await expect(page).toHaveURL(/login/, { timeout: 5_000 });
  });

  test('Level test page redirects to /login when unauthenticated', async ({ page }) => {
    await page.goto('/level-test');
    await expect(page).toHaveURL(/login/, { timeout: 5_000 });
  });

  test('Track select page redirects to /login when unauthenticated', async ({ page }) => {
    await page.goto('/track-select');
    await expect(page).toHaveURL(/login/, { timeout: 5_000 });
  });
});
