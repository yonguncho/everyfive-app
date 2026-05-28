/**
 * 실제 사용자 흐름 — UI에서 signInWithOtp → Mailpit에서 6자리 코드 추출 → 입력 → /level-test
 * 매직 링크/콜백 의존성 없음
 */
import { test, expect } from '@playwright/test';
import { admin, deleteTestUser } from './helpers';

const MAILPIT_API = 'http://127.0.0.1:54324/api/v1';
const TEST_EMAIL = 'e2e-otp@test.local';

async function clearMailpit() {
  try { await fetch(`${MAILPIT_API}/messages`, { method: 'DELETE' }); } catch {}
}

async function pollOtpCode(email: string, timeoutMs = 20000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${MAILPIT_API}/messages`);
    const data = await r.json();
    const msg = data.messages?.find((m: any) =>
      m.To?.some((t: any) => t.Address === email)
    );
    if (msg) {
      const full = await fetch(`${MAILPIT_API}/message/${msg.ID}`).then((x) => x.json());
      const body = (full.Text ?? '') + '\n' + (full.HTML ?? '');
      // 6자리 코드 추출: "enter the code: 123456" 또는 단독 6자리
      const m = body.match(/(?:code[:\s]*|alternatively[,\s]+enter the code[:\s]*)(\d{6})/i)
              || body.match(/\b(\d{6})\b/);
      if (m) return m[1];
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`No OTP for ${email}`);
}

test.describe('Real OTP flow (signInWithOtp + verifyOtp)', () => {
  test.beforeEach(async () => {
    await clearMailpit();
    await deleteTestUser(TEST_EMAIL);
  });
  test.afterAll(async () => { await deleteTestUser(TEST_EMAIL); });

  test('Full flow: submit email → receive code → enter → /level-test', async ({ page }) => {
    await page.goto('/login');

    // 이메일 입력 (input value 안정화 위해 click + type)
    const emailInput = page.getByPlaceholder('your@email.com');
    await emailInput.waitFor({ state: 'visible' });
    await emailInput.click();
    await page.waitForTimeout(300);  // hydration 완료 대기
    await emailInput.pressSequentially(TEST_EMAIL, { delay: 50 });
    await expect(emailInput).toHaveValue(TEST_EMAIL);

    // 폼 직접 submit
    // 버튼이 enabled 될 때까지 대기 (React 상태 갱신)
    const submitBtn = page.getByRole('button', { name: /코드 받기/ });
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();

    // 코드 입력 화면 표시
    await expect(page.getByRole('heading', { name: '이메일 코드 입력' })).toBeVisible({ timeout: 15_000 });

    // Mailpit에서 코드 추출
    const code = await pollOtpCode(TEST_EMAIL);
    expect(code).toMatch(/^\d{6}$/);
    console.log(`OTP code: ${code}`);

    // 코드 입력
    const otpInput = page.getByPlaceholder('000000');
    await otpInput.click();
    await page.keyboard.type(code, { delay: 30 });
    await expect(otpInput).toHaveValue(code);

    // 확인 버튼
    await page.getByRole('button', { name: '확인' }).click();

    // /level-test 진입
    await expect(page).toHaveURL(/level-test/, { timeout: 15_000 });
    await expect(page.getByText(/레벨 테스트/)).toBeVisible({ timeout: 5_000 });

    // 보호 라우트 접근 가능
    await page.goto('/daily');
    await expect(page).toHaveURL(/daily/, { timeout: 5_000 });
  });

  test('Wrong OTP code → error message', async ({ page }) => {
    // 별도 이메일 (rate limit 회피)
    const WRONG_OTP_EMAIL = 'e2e-otp-wrong@test.local';
    await deleteTestUser(WRONG_OTP_EMAIL);
    await admin.auth.admin.createUser({ email: WRONG_OTP_EMAIL, email_confirm: true });

    await page.goto('/login');
    const emailInput = page.getByPlaceholder('your@email.com');
    await emailInput.click();
    await page.waitForTimeout(300);
    await emailInput.pressSequentially(WRONG_OTP_EMAIL, { delay: 50 });
    await expect(emailInput).toHaveValue(WRONG_OTP_EMAIL);
    // 버튼이 enabled 될 때까지 대기 (React 상태 갱신)
    const submitBtn = page.getByRole('button', { name: /코드 받기/ });
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();
    await expect(page.getByRole('heading', { name: '이메일 코드 입력' })).toBeVisible({ timeout: 15_000 });

    // 잘못된 코드
    await page.getByPlaceholder('000000').click();
    await page.keyboard.type('000000', { delay: 30 });
    await page.getByRole('button', { name: '확인' }).click();

    // 에러 메시지
    await expect(page.locator('p.text-red-600')).toBeVisible({ timeout: 10_000 });
    // /level-test로 이동 X
    await expect(page).toHaveURL(/login/);
  });
});
