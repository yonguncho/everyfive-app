import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

await page.goto('https://app.lemonsqueezy.com/login', { waitUntil: 'networkidle' });

// 모든 링크 확인
const links = await page.$$eval('a', els => els.map(e => ({ href: e.href, text: e.innerText?.trim().slice(0, 60) })));
console.log('LINKS:', JSON.stringify(links, null, 2));

// social login 버튼
const socials = await page.$$eval('[class*="social"],[class*="google"],[class*="oauth"],[class*="provider"]',
  els => els.map(e => ({ tag: e.tagName, class: e.className, text: e.innerText?.trim().slice(0,60) })));
console.log('SOCIAL_BUTTONS:', JSON.stringify(socials, null, 2));

await browser.close();
