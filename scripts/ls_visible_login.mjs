import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATUS_FILE = path.join(__dirname, 'auth_status.txt');
const OTP_FILE = path.join(__dirname, 'otp.txt');

function writeStatus(s) {
  try { fs.writeFileSync(STATUS_FILE, s); } catch {}
  console.log('[STATUS]', s);
}

async function waitForOtp(label, timeoutMs = 300_000) {
  if (fs.existsSync(OTP_FILE)) fs.unlinkSync(OTP_FILE);
  writeStatus('WAITING_FOR_' + label);
  console.log(`\n📌 [입력 필요] ${label} → scripts/otp.txt 파일에 저장하거나 채팅으로 알려주세요\n`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(OTP_FILE)) {
      const val = fs.readFileSync(OTP_FILE, 'utf8').trim();
      if (val) { fs.unlinkSync(OTP_FILE); return val; }
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`${label} 타임아웃`);
}

writeStatus('STARTING');

const browser = await chromium.launch({
  channel: 'msedge',
  headless: false,
  args: ['--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled'],
});

const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0',
});
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
});

const page = await ctx.newPage();
writeStatus('BROWSER_OPEN');
console.log('✅ 브라우저 창이 열렸습니다. 화면에서 확인해주세요.');

await page.goto('https://auth.lemonsqueezy.com/google/login', { waitUntil: 'commit', timeout: 30_000 });
console.log('초기 URL:', page.url());
writeStatus('NAVIGATED:' + page.url().slice(0, 80));

// 현재 URL에 따라 분기
const url0 = page.url();

if (url0.includes('app.lemonsqueezy.com') && !url0.includes('/login')) {
  console.log('✅ 이미 LemonSqueezy에 로그인됨');
} else if (url0.includes('accounts.google.com')) {
  console.log('🔐 Google 로그인 페이지 감지');

  // 이메일 자동 입력
  try {
    await page.waitForSelector('input[type="email"]', { timeout: 5000 });
    await page.fill('input[type="email"]', 'yongun.cho03@gmail.com');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
    console.log('이메일 입력 후 URL:', page.url());
  } catch (e) {
    console.log('이메일 입력 에러:', e.message);
  }

  // blocked 또는 다음 단계 확인
  const url1 = page.url();
  const body1 = await page.evaluate(() => document.body.innerText).catch(() => '');
  console.log('URL1:', url1.slice(0, 80));
  console.log('BODY1:', body1.slice(0, 300));

  if (url1.includes('rejected') || body1.includes('안전하지') || body1.includes('unsafe')) {
    writeStatus('GOOGLE_BLOCKED');
    console.log('❌ Google 자동화 차단 — 수동 로그인 필요');
    // 로그인 페이지로 다시 이동해서 사용자가 처음부터 진행하도록
    await page.goto('https://accounts.google.com/signin/oauth/consent', { waitUntil: 'commit' }).catch(() => {});
    await page.goto('https://auth.lemonsqueezy.com/login', { waitUntil: 'networkidle' });
    console.log('📌 LemonSqueezy 로그인 페이지로 이동했습니다. 직접 로그인해주세요.');
    writeStatus('WAITING_MANUAL_LOGIN');
  } else if (await page.$('input[type="password"]')) {
    // 비밀번호 필요
    const pw = await waitForOtp('GOOGLE_PASSWORD');
    await page.fill('input[type="password"]', pw);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
    console.log('비밀번호 입력 후 URL:', page.url());
  } else if (await page.$('input[type="tel"], input[autocomplete="one-time-code"]')) {
    // OTP 필요
    const otp = await waitForOtp('OTP');
    await page.fill('input[type="tel"], input[autocomplete="one-time-code"]', otp);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
  }
}

// LemonSqueezy 대시보드 대기 (최대 5분)
console.log('\n⏳ LemonSqueezy 대시보드 대기 중 (화면에서 로그인 완료해주세요)...');
writeStatus('WAITING_LS_DASHBOARD');

let loginSuccess = false;
const deadline = Date.now() + 300_000;
while (Date.now() < deadline) {
  const currentUrl = page.url();
  if (currentUrl.includes('app.lemonsqueezy.com') && !currentUrl.includes('/login')) {
    loginSuccess = true;
    break;
  }
  await page.waitForTimeout(1000);
}

if (!loginSuccess) {
  writeStatus('LOGIN_TIMEOUT');
  console.error('❌ 로그인 타임아웃');
  await browser.close();
  process.exit(1);
}

console.log('✅ 로그인 성공! URL:', page.url());
writeStatus('LOGGED_IN');

// API 키 설정 페이지
await page.goto('https://app.lemonsqueezy.com/settings/api', { waitUntil: 'networkidle', timeout: 30_000 });
await page.waitForTimeout(1000);

const pageText = await page.evaluate(() => document.body.innerText);
console.log('\n=== API 페이지 ===\n', pageText.slice(0, 800));
const btns = await page.$$eval('button', els => els.map(e => e.innerText?.trim()).filter(Boolean));
console.log('버튼들:', JSON.stringify(btns));

// Add API key
const addBtn = await page.$('button:has-text("Add API key"), a:has-text("Add API key"), button:has-text("New"), button:has-text("Create key")');
if (addBtn) {
  await addBtn.click();
  await page.waitForTimeout(2000);
  const nameInput = await page.$('input[type="text"]:not([type="hidden"])');
  if (nameInput) await nameInput.fill('everyfive-app-prod-2026');
  const saveBtn = await page.$('button[type="submit"], button:has-text("Create"), button:has-text("Save")');
  if (saveBtn) { await saveBtn.click(); await page.waitForTimeout(3000); }
} else {
  writeStatus('NO_ADD_BTN');
  console.log('⚠️  Add API key 버튼 없음');
}

const finalText = await page.evaluate(() => document.body.innerText);
console.log('\n=== 최종 페이지 ===\n', finalText.slice(0, 2000));

const keyMatch = finalText.match(/eyJ[A-Za-z0-9_\-\.]{80,}/);
if (keyMatch) {
  console.log('\n🔑 NEW_API_KEY:', keyMatch[0]);
  writeStatus('DONE:' + keyMatch[0]);
} else {
  writeStatus('DONE_NO_KEY');
}

await browser.close();
