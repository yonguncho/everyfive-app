import { chromium } from 'playwright';

const EMAIL = 'yongun.cho03@gmail.com';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

await page.goto('https://auth.lemonsqueezy.com/password/reset', { waitUntil: 'networkidle' });

// form action 확인
const formInfo = await page.$eval('form', f => ({
  action: f.action,
  method: f.method,
  enctype: f.enctype
}));
console.log('FORM:', JSON.stringify(formInfo));

// 모든 input 확인 (숨겨진 것 포함)
const allInputs = await page.$$eval('input, select, textarea', els => els.map(e => ({
  type: e.type, name: e.name, value: e.value?.slice(0, 30)
})));
console.log('ALL_INPUTS:', JSON.stringify(allInputs));

// hCaptcha, reCaptcha 확인
const html = await page.content();
const hasCaptcha = html.includes('hcaptcha') || html.includes('recaptcha') || html.includes('turnstile');
console.log('HAS_CAPTCHA:', hasCaptcha);
if (hasCaptcha) {
  const captchaIdx = Math.max(html.indexOf('hcaptcha'), html.indexOf('recaptcha'), html.indexOf('turnstile'));
  console.log('CAPTCHA_CONTEXT:', html.slice(captchaIdx - 100, captchaIdx + 200));
}

// 버튼이 disabled인 이유 파악
const btnInfo = await page.$eval('button[type="submit"]', b => ({
  disabled: b.disabled,
  class: b.className,
  onclick: b.getAttribute('onclick'),
}));
console.log('BTN_INFO:', JSON.stringify(btnInfo));

await browser.close();
