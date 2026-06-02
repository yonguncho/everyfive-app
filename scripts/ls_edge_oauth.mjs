/**
 * Edge 브라우저 + 기존 프로필로 LemonSqueezy Google OAuth
 * OTP 필요 시 scripts/otp.txt 에 코드 저장
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OTP_FILE = path.join(__dirname, 'otp.txt');
const STATUS_FILE = path.join(__dirname, 'auth_status.txt');
const EDGE_USER_DATA = 'C:\\Users\\yongu\\AppData\\Local\\Microsoft\\Edge\\User Data';

if (fs.existsSync(OTP_FILE)) fs.unlinkSync(OTP_FILE);
fs.writeFileSync(STATUS_FILE, 'STARTING');

function writeStatus(s) {
  fs.writeFileSync(STATUS_FILE, s);
  console.log('[STATUS]', s);
}

async function waitForOtp(timeoutMs = 300_000) {
  writeStatus('WAITING_FOR_OTP');
  console.log('\n⏳ OTP/비밀번호 대기 중... scripts/otp.txt 에 저장하거나 채팅에 입력해주세요\n');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(OTP_FILE)) {
      const code = fs.readFileSync(OTP_FILE, 'utf8').trim();
      if (code) {
        fs.unlinkSync(OTP_FILE);
        console.log('코드 수신:', code);
        return code;
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('타임아웃 (5분)');
}

let ctx;
try {
  writeStatus('LAUNCHING_EDGE');
  // 실제 Edge 브라우저 + 기존 사용자 프로필 사용
  ctx = await chromium.launchPersistentContext(EDGE_USER_DATA, {
    channel: 'msedge',
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions'],
  });
} catch (err) {
  console.error('Edge persistent context 실패:', err.message);
  // fallback: 기본 프로필 없이 시도
  writeStatus('LAUNCHING_EDGE_CLEAN');
  ctx = await chromium.launchPersistentContext('', {
    channel: 'msedge',
    headless: true,
    args: ['--no-first-run'],
  });
}

const page = ctx.pages()[0] || await ctx.newPage();

try {
  writeStatus('NAVIGATING');
  await page.goto('https://auth.lemonsqueezy.com/google/login', { waitUntil: 'commit', timeout: 30_000 });
  await page.waitForTimeout(3000);
  console.log('현재 URL:', page.url());

  // 이미 LemonSqueezy에 로그인됐으면 바로 진행
  if (page.url().includes('app.lemonsqueezy.com') && !page.url().includes('/login')) {
    console.log('✅ 이미 로그인 상태!');
    writeStatus('ALREADY_LOGGED_IN');
  } else if (page.url().includes('accounts.google.com')) {
    writeStatus('GOOGLE_AUTH_NEEDED');
    const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
    console.log('Google 페이지 내용:', bodyText.slice(0, 400));

    // 이메일 입력 가능한지 확인
    const emailInput = await page.$('input[type="email"]');
    if (emailInput) {
      const EMAIL = 'yongun.cho03@gmail.com';
      await emailInput.fill(EMAIL);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);
      console.log('이메일 입력 후 URL:', page.url());

      const bodyAfterEmail = await page.evaluate(() => document.body.innerText).catch(() => '');
      console.log('이메일 후 내용:', bodyAfterEmail.slice(0, 500));

      // rejected 여부 확인
      if (page.url().includes('rejected') || bodyAfterEmail.includes('안전하지') || bodyAfterEmail.includes('unsafe')) {
        console.log('❌ Google이 자동화를 차단함 — Edge 채널 시도에도 차단됨');
        writeStatus('BLOCKED_BY_GOOGLE');
        await ctx.close();
        process.exit(2);
      }

      // 비밀번호 필드?
      const pwInput = await page.$('input[type="password"]');
      if (pwInput) {
        writeStatus('NEEDS_PASSWORD');
        const pw = await waitForOtp(120_000);
        await pwInput.fill(pw);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);
        console.log('비밀번호 입력 후 URL:', page.url());
      }

      // OTP 필드?
      const otpInput = await page.$('input[type="tel"], input[autocomplete="one-time-code"]');
      if (otpInput) {
        writeStatus('NEEDS_OTP');
        const otp = await waitForOtp();
        await otpInput.fill(otp);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);
      }
    }

    // LemonSqueezy 대시보드 대기
    await page.waitForURL(url => url.includes('app.lemonsqueezy.com') && !url.includes('/login'), { timeout: 90_000 });
  }

  // API 키 생성
  console.log('✅ LemonSqueezy 대시보드 진입. URL:', page.url());
  writeStatus('GENERATING_API_KEY');

  await page.goto('https://app.lemonsqueezy.com/settings/api', { waitUntil: 'networkidle', timeout: 30_000 });
  console.log('API 설정 URL:', page.url());

  const apiText = await page.evaluate(() => document.body.innerText);
  console.log('API 페이지 텍스트:', apiText.slice(0, 600));

  // Add API key 버튼
  await page.waitForTimeout(1000);
  const addBtn = await page.$('button:has-text("Add API key"), button:has-text("New"), a:has-text("Add API key")');
  if (!addBtn) {
    const btns = await page.$$eval('button', els => els.map(e => e.innerText?.trim()));
    console.log('버튼 목록:', JSON.stringify(btns));
    throw new Error('Add API key 버튼을 찾을 수 없음');
  }

  await addBtn.click();
  await page.waitForTimeout(2000);

  const nameInput = await page.$('input[placeholder*="name" i], input[placeholder*="label" i], input[type="text"]');
  if (nameInput) await nameInput.fill('everyfive-app-prod-2026');

  const saveBtn = await page.$('button:has-text("Create"), button:has-text("Save"), button:has-text("Add"), button[type="submit"]');
  if (saveBtn) await saveBtn.click();
  await page.waitForTimeout(3000);

  const pageAfter = await page.evaluate(() => document.body.innerText);
  console.log('생성 후 페이지:', pageAfter.slice(0, 1200));

  const keyMatch = pageAfter.match(/eyJ[A-Za-z0-9_\-\.]{80,}/);
  if (keyMatch) {
    console.log('\n🔑 NEW_API_KEY:', keyMatch[0]);
    writeStatus('DONE:' + keyMatch[0]);
  } else {
    writeStatus('DONE_KEY_NOT_EXTRACTED');
    console.log('키 자동 추출 실패');
  }

} catch (err) {
  writeStatus('ERROR: ' + err.message);
  console.error('ERROR:', err.message);
  const url = page.url().catch(() => '');
  console.log('ERROR_URL:', url);
  process.exit(1);
} finally {
  await ctx.close();
}
