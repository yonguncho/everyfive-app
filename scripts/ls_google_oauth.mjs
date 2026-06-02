/**
 * LemonSqueezy Google OAuth 자동화
 * OTP 필요 시 C:\AI_WORKPLACE\today_product\everyfive-app\scripts\otp.txt 파일에 OTP를 저장하면 계속 진행
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OTP_FILE = path.join(__dirname, 'otp.txt');
const STATUS_FILE = path.join(__dirname, 'auth_status.txt');

const EMAIL = 'yongun.cho03@gmail.com';

// OTP 파일 초기화
if (fs.existsSync(OTP_FILE)) fs.unlinkSync(OTP_FILE);
fs.writeFileSync(STATUS_FILE, 'STARTING');

function writeStatus(s) {
  fs.writeFileSync(STATUS_FILE, s);
  console.log('[STATUS]', s);
}

async function waitForOtp(timeoutMs = 300_000) {
  writeStatus('WAITING_FOR_OTP');
  console.log(`\n⏳ OTP 대기 중... (${OTP_FILE} 에 코드 저장 또는 여기에 입력)\n`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(OTP_FILE)) {
      const code = fs.readFileSync(OTP_FILE, 'utf8').trim();
      if (code) {
        fs.unlinkSync(OTP_FILE);
        console.log('OTP 수신:', code);
        return code;
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('OTP 타임아웃 (5분)');
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 800 },
  locale: 'ko-KR',
});
const page = await ctx.newPage();

try {
  writeStatus('NAVIGATING_TO_LS_GOOGLE_LOGIN');
  await page.goto('https://auth.lemonsqueezy.com/google/login', { waitUntil: 'commit' });
  await page.waitForTimeout(2000);
  console.log('현재 URL:', page.url());

  // Google 로그인 페이지 처리
  if (page.url().includes('accounts.google.com')) {
    writeStatus('GOOGLE_LOGIN_PAGE');
    console.log('Google 로그인 페이지 감지');

    // 이메일 입력
    const emailInput = await page.$('input[type="email"]');
    if (emailInput) {
      await emailInput.fill(EMAIL);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);
      console.log('이메일 입력 후 URL:', page.url());
    }

    // 다음 단계 확인
    const url2 = page.url();
    const content2 = await page.content();

    // 비밀번호 입력 필요?
    const needsPassword = content2.includes('password') || content2.includes('비밀번호') ||
                          await page.$('input[type="password"]') !== null;

    // OTP/인증 코드 입력 필요?
    const needsOtp = content2.includes('verification') || content2.includes('OTP') ||
                     content2.includes('인증') || content2.includes('2-step') ||
                     content2.includes('2단계') || content2.includes('code') ||
                     await page.$('input[data-initial-value]') !== null;

    // 전화/이메일 OTP?
    const needsPhoneOtp = content2.includes('phone') || content2.includes('핸드폰') ||
                          content2.includes('sent') || content2.includes('보냈');

    console.log('needsPassword:', needsPassword, 'needsOtp:', needsOtp, 'needsPhoneOtp:', needsPhoneOtp);

    // 현재 페이지 스냅샷
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
    console.log('BODY_TEXT_SNIPPET:', bodyText.slice(0, 600));

    if (needsOtp || needsPhoneOtp) {
      const otp = await waitForOtp();
      const otpInput = await page.$('input[type="tel"], input[data-initial-value], input[autocomplete="one-time-code"]');
      if (otpInput) {
        await otpInput.fill(otp);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);
      }
    } else if (needsPassword) {
      writeStatus('NEEDS_PASSWORD');
      console.log('비밀번호 필요 — 비밀번호를 otp.txt에 저장해주세요 (임시)');
      const pw = await waitForOtp(120_000);
      const pwInput = await page.$('input[type="password"]');
      if (pwInput) {
        await pwInput.fill(pw);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);
      }

      // 비밀번호 입력 후 OTP 필요?
      const content3 = await page.content();
      const bodyText3 = await page.evaluate(() => document.body.innerText).catch(() => '');
      console.log('비밀번호 후 URL:', page.url());
      console.log('비밀번호 후 BODY:', bodyText3.slice(0, 400));

      const needsOtp2 = content3.includes('verification') || content3.includes('code') ||
                        content3.includes('인증') || content3.includes('2-step') ||
                        content3.includes('sent') || content3.includes('phone');
      if (needsOtp2) {
        const otp2 = await waitForOtp();
        const otpInput2 = await page.$('input[type="tel"], input[data-initial-value], input[autocomplete="one-time-code"]');
        if (otpInput2) {
          await otpInput2.fill(otp2);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(3000);
        }
      }
    }
  }

  // LemonSqueezy 대시보드 대기
  writeStatus('WAITING_FOR_LS_DASHBOARD');
  await page.waitForURL(url => url.includes('app.lemonsqueezy.com') && !url.includes('/login'), { timeout: 60_000 });
  console.log('✅ LemonSqueezy 로그인 성공! URL:', page.url());
  writeStatus('LOGGED_IN');

  // API 키 페이지로 이동
  await page.goto('https://app.lemonsqueezy.com/settings/api', { waitUntil: 'networkidle' });
  console.log('API 설정 페이지:', page.url());

  const apiPageText = await page.evaluate(() => document.body.innerText);
  console.log('API_PAGE_SNIPPET:', apiPageText.slice(0, 500));

  // "Add API key" 버튼 클릭
  const addBtn = await page.$('button:has-text("Add API key"), button:has-text("Create"), a:has-text("Add API key"), a:has-text("New API key")');
  if (!addBtn) {
    console.log('ADD_BTN_NOT_FOUND');
    // 버튼 목록 출력
    const buttons = await page.$$eval('button, a[role="button"]', els => els.map(e => e.innerText?.trim().slice(0, 50)));
    console.log('BUTTONS:', JSON.stringify(buttons));
    writeStatus('ERROR_NO_ADD_BTN');
    await browser.close();
    process.exit(1);
  }

  await addBtn.click();
  await page.waitForTimeout(2000);

  // 키 이름 입력 모달/폼
  const nameInput = await page.$('input[placeholder*="name" i], input[placeholder*="label" i], input[type="text"]');
  if (nameInput) {
    await nameInput.fill('everyfive-app-prod-2026');
  }

  // 생성 확인 버튼
  const confirmBtn = await page.$('button:has-text("Create"), button:has-text("Save"), button:has-text("Add"), button[type="submit"]');
  if (confirmBtn) await confirmBtn.click();
  await page.waitForTimeout(3000);

  // 새 API 키 캡처
  const pageAfter = await page.evaluate(() => document.body.innerText);
  console.log('PAGE_AFTER_CREATE:', pageAfter.slice(0, 1000));

  // API 키 패턴 추출 (eyJ... 형태의 JWT 또는 영숫자 긴 문자열)
  const keyMatch = pageAfter.match(/eyJ[A-Za-z0-9_\-\.]{100,}/) ||
                   pageAfter.match(/[a-zA-Z0-9]{40,}/);
  if (keyMatch) {
    console.log('NEW_API_KEY:', keyMatch[0]);
    writeStatus('DONE:' + keyMatch[0]);
  } else {
    writeStatus('DONE_BUT_KEY_NOT_EXTRACTED');
    console.log('키 자동 추출 실패 — 위 PAGE_AFTER_CREATE 확인 필요');
  }

} catch (err) {
  writeStatus('ERROR: ' + err.message);
  console.error('ERROR:', err.message);
  const url = page.url();
  const txt = await page.evaluate(() => document.body.innerText).catch(() => '');
  console.log('ERROR_URL:', url);
  console.log('ERROR_BODY:', txt.slice(0, 600));
  process.exit(1);
} finally {
  await browser.close();
}
