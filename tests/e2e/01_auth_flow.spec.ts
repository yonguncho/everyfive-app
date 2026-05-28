/**
 * Stream A — Auth + Onboarding 통합 베타 테스트
 */
import { test, expect } from '@playwright/test';
import { createTestUser, deleteTestUser, signInAsUser, injectSession, getProfile, admin } from './helpers';

const TEST_EMAIL = 'e2e-auth@test.local';

test.describe('Stream A: Auth + Onboarding', () => {
  test.beforeEach(async () => { await deleteTestUser(TEST_EMAIL); });
  test.afterAll(async () => { await deleteTestUser(TEST_EMAIL); });

  test('Landing page renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('평생 무료')).toBeVisible();
    await expect(page.getByRole('link', { name: '시작하기' })).toBeVisible();
  });

  test('Login page renders', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: '로그인' })).toBeVisible();
    await expect(page.getByPlaceholder('your@email.com')).toBeVisible();
    await expect(page.getByRole('button', { name: /코드 받기/ })).toBeVisible();
  });

  test('Auth trigger creates profile automatically', async () => {
    const user = await createTestUser(TEST_EMAIL);
    const profile = await getProfile(user.id);
    expect(profile).toBeTruthy();
    expect(profile.level).toBe('A1');
    expect(profile.track).toBe('daily');
    expect(profile.current_streak).toBe(0);
  });

  test('Protected route redirects to /login when unauthenticated', async ({ page }) => {
    await page.goto('/daily');
    await expect(page).toHaveURL(/login/, { timeout: 5_000 });
  });

  test('Profile UPDATE via admin client (server-side flow)', async () => {
    const user = await createTestUser(TEST_EMAIL);
    // 레벨 테스트가 호출하는 동일한 UPDATE를 직접 검증
    const { error } = await admin.from('profiles')
      .update({ level: 'B2', last_level_test_at: new Date().toISOString() })
      .eq('id', user.id);
    expect(error).toBeNull();
    const updated = await getProfile(user.id);
    expect(updated.level).toBe('B2');
    expect(updated.last_level_test_at).toBeTruthy();
  });

  test('Track UPDATE via admin client', async () => {
    const user = await createTestUser(TEST_EMAIL);
    const { error } = await admin.from('profiles').update({ track: 'academic' }).eq('id', user.id);
    expect(error).toBeNull();
    const updated = await getProfile(user.id);
    expect(updated.track).toBe('academic');
  });

  test('Sign-in flow (password) returns valid JWT', async () => {
    await createTestUser(TEST_EMAIL);
    const sess = await signInAsUser(TEST_EMAIL);
    expect(sess.access_token).toBeTruthy();
    expect(sess.refresh_token).toBeTruthy();
    expect(sess.user.email).toBe(TEST_EMAIL);
  });
});
