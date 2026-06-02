import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

await page.goto('https://auth.lemonsqueezy.com/login', { waitUntil: 'networkidle' });

// reCaptcha 확인
const html = await page.content();
const hasCaptcha = html.includes('hcaptcha') || html.includes('recaptcha') || html.includes('turnstile') || html.includes('g-recaptcha');
console.log('LOGIN_HAS_CAPTCHA:', hasCaptcha);

// 모든 input 확인
const allInputs = await page.$$eval('input, select, textarea', els => els.map(e => ({
  type: e.type, name: e.name
})));
console.log('LOGIN_INPUTS:', JSON.stringify(allInputs));

const formInfo = await page.$eval('form', f => ({
  action: f.action,
  method: f.method,
}));
console.log('LOGIN_FORM:', JSON.stringify(formInfo));

await browser.close();
