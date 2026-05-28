/**
 * EveryFive 결제 플로우 실행 테스트 (MCP 협동 버전)
 * - DB 검증은 Supabase MCP execute_sql이 담당
 * - 이 스크립트는 HTTP 레이어만 테스트 (webhook + API)
 * - SUPABASE_SERVICE_ROLE_KEY 불필요
 *
 * 전제: MCP로 생성된 테스트 사용자
 *   id:    70834d7a-e06f-42da-a8ec-c8b376f6dec8
 *   email: test_payment_1779761793@everyfive.test
 *   pass:  TestPass1234!
 */

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnv(filePath) {
  const env = {};
  try {
    readFileSync(filePath, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, '');
    });
  } catch { /* ignore */ }
  return env;
}

const ENV_FILE = new URL('../../.env.local', import.meta.url)
  .pathname.replace(/^\/([A-Z]:)/, '$1');
const env = { ...loadEnv(ENV_FILE), ...process.env };

const SUPABASE_URL      = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const WEBHOOK_SECRET    = env.LEMON_SQUEEZY_WEBHOOK_SECRET;
const VARIANT_PRO_10    = env.LEMON_SQUEEZY_VARIANT_PRO_10 ?? '0';

const MISSING = [!SUPABASE_URL && 'NEXT_PUBLIC_SUPABASE_URL', !SUPABASE_ANON_KEY && 'NEXT_PUBLIC_SUPABASE_ANON_KEY', !WEBHOOK_SECRET && 'LEMON_SQUEEZY_WEBHOOK_SECRET'].filter(Boolean);
if (MISSING.length) { console.error('❌ 환경변수 없음:', MISSING.join(', ')); process.exit(1); }

// MCP로 생성한 테스트 사용자 (고정)
const TEST_USER_ID    = 'ff25615b-cfe3-470a-a4c6-967068be7ff9';
const TEST_USER_EMAIL = 'testpay_flow@everyfive.test';
const TEST_USER_PASS  = 'TestPass1234!';

const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/ls-webhook`;
const APP_URL     = 'https://everyfive-app.vercel.app';
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const COOKIE_NAME = `sb-${PROJECT_REF}-auth-token`;

let passed = 0, failed = 0;
const failures = [];

function assert(label, condition, detail = '') {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else { const m = `${label}${detail ? ` — ${detail}` : ''}`; console.error(`  ❌ ${m}`); failures.push(m); failed++; }
}

function signPayload(body) {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

function buildAuthCookie(session) {
  // @supabase/ssr createChunks(): encodedLen<=3180 → { name: key, value } (raw, NOT URL-encoded)
  // cookie.parse() does not URL-decode, so we must NOT encodeURIComponent here
  const json = JSON.stringify({
    access_token:  session.access_token,
    token_type:    session.token_type ?? 'bearer',
    expires_in:    session.expires_in,
    expires_at:    session.expires_at,
    refresh_token: session.refresh_token,
    user:          session.user,
  });
  return `${COOKIE_NAME}=${json}`;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let _seq = 0;
function buildLsPayload({ eventName = 'subscription_created', userId = TEST_USER_ID, plan = 'pro_10', status = 'active', cancelled = false, endsAt = null, trialEnd = null, renewsAt = new Date(Date.now() + 30 * 86400_000).toISOString(), updatedAt = new Date().toISOString(), subId = `sub_${Date.now()}_${++_seq}`, custId = '12345678', variantId = parseInt(VARIANT_PRO_10, 10) || 111111 } = {}) {
  return JSON.stringify({ meta: { event_name: eventName, custom_data: userId ? { user_id: userId, plan } : {} }, data: { id: subId, attributes: { status, variant_id: variantId, customer_id: parseInt(custId, 10), cancelled, ends_at: endsAt, trial_ends_at: trialEnd, renews_at: renewsAt, updated_at: updatedAt } } });
}

async function postWebhook(body, { sig, requestId = crypto.randomUUID() } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (sig !== undefined) headers['X-Signature'] = sig;
  if (requestId) headers['X-Request-Id'] = requestId;
  return fetch(WEBHOOK_URL, { method: 'POST', headers, body });
}
function postWebhookSigned(body, opts = {}) { return postWebhook(body, { sig: signPayload(body), ...opts }); }

// ── 로그인해서 쿠키 획득 ──────────────────────────────────────────────
let testCookie = null;
async function login() {
  const { data, error } = await anon.auth.signInWithPassword({ email: TEST_USER_EMAIL, password: TEST_USER_PASS });
  if (error || !data.session) { console.error('❌ 로그인 실패:', error?.message); process.exit(1); }
  testCookie = buildAuthCookie(data.session);
  console.log(`  → 로그인 성공 (user: ${TEST_USER_ID})`);
}

// ─────────────────────────────────────────────────────────────────────
// Phase 1: create-checkout API
// ─────────────────────────────────────────────────────────────────────
async function phase1() {
  console.log('\n📦 Phase 1: create-checkout API');

  // 1-A: valid plan + 미인증 → 401
  { const r = await fetch(`${APP_URL}/api/create-checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: 'pro_10' }) }); assert('1-A valid plan + 미인증 → 401', r.status === 401, `status=${r.status}`); }

  // 1-B: invalid plan → 400
  { const r = await fetch(`${APP_URL}/api/create-checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: 'pro_99' }) }); assert('1-B invalid plan → 400', r.status === 400, `status=${r.status}`); }

  // 1-C: 쿠키 인증 + pro_10 → 인증 성공 (200: checkout URL / 409: already_subscribed)
  // ACTIVE 구독이 보장된 상태 → 409가 인증 증명; 유효한 LS API 키가 있으면 200
  { const r = await fetch(`${APP_URL}/api/create-checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: testCookie }, body: JSON.stringify({ plan: 'pro_10' }) }); const body = await r.json().catch(() => ({})); const checkoutOk = r.status === 200 && typeof body.url === 'string' && body.url.startsWith('https://'); const alreadyOk = r.status === 409; const ok = checkoutOk || alreadyOk; assert('1-C 쿠키 인증 성공 (200 checkout URL or 409 already_subscribed)', ok, `status=${r.status} body=${JSON.stringify(body)}`); if (alreadyOk) console.log('  (인증 성공, 구독 중복 → 409 expected)'); }
}

// ─────────────────────────────────────────────────────────────────────
// Phase 2: webhook 서명/응답 검증
// ─────────────────────────────────────────────────────────────────────
async function phase2() {
  console.log('\n🔗 Phase 2: ls-webhook 서명 및 응답');

  // 2-A: 서명 없음 → 400
  { const r = await postWebhook(buildLsPayload(), { sig: undefined, requestId: null }); assert('2-A 서명 없음 → 400', r.status === 400, `status=${r.status}`); }

  // 2-B: 잘못된 서명 → 400
  { const r = await postWebhook(buildLsPayload(), { sig: 'deadbeef' }); assert('2-B 잘못된 서명 → 400', r.status === 400, `status=${r.status}`); }

  // 2-C: 정상 subscription_created → 200
  const subId_2c = `sub_2c_${Date.now()}`;
  const reqId_2c = crypto.randomUUID();
  { const body = buildLsPayload({ subId: subId_2c }); const r = await postWebhookSigned(body, { requestId: reqId_2c }); const text = await r.text(); assert('2-C 정상 webhook → 200 OK', r.status === 200 && text.includes('OK'), `status=${r.status} body=${text}`); }
  console.log(`  → [MCP 확인] subscriptions WHERE user_id='${TEST_USER_ID}' — status=ACTIVE, ls_subscription_id='${subId_2c}'`);
  console.log(`  → [MCP 확인] ls_events WHERE event_id='${reqId_2c}'`);
  await sleep(600);

  // 2-D: 동일 X-Request-Id 중복 → 200 Duplicate
  { const fixedId = crypto.randomUUID(); const body = buildLsPayload(); const sig = signPayload(body); await postWebhook(body, { sig, requestId: fixedId }); const r2 = await postWebhook(body, { sig, requestId: fixedId }); const t2 = await r2.text(); assert('2-D 동일 X-Request-Id → Duplicate', r2.status === 200 && t2.includes('Duplicate'), `body=${t2}`); }

  // 2-E: X-Request-Id 없는 fallback key 중복
  { const sharedAt = new Date().toISOString(); const sharedSub = `sub_2e_${Date.now()}`; const body = buildLsPayload({ subId: sharedSub, updatedAt: sharedAt, eventName: 'subscription_updated' }); await postWebhookSigned(body, { requestId: null }); const r2 = await postWebhookSigned(body, { requestId: null }); const t2 = await r2.text(); assert('2-E fallback key 중복 → Duplicate', r2.status === 200 && t2.includes('Duplicate'), `body=${t2}`); }

  // 2-F: user_id 없음 → 200 graceful
  { const r = await postWebhookSigned(buildLsPayload({ userId: null })); assert('2-F user_id 없음 → 200', r.status === 200, `status=${r.status}`); }

  // 2-G: invalid JSON + valid signature → 400
  { const bad = '{"invalid":}'; const r = await postWebhook(bad, { sig: signPayload(bad) }); assert('2-G invalid JSON → 400', r.status === 400, `status=${r.status}`); }
}

// ─────────────────────────────────────────────────────────────────────
// Phase 3: 상태 전이 (DB 검증은 MCP로 별도 수행)
// ─────────────────────────────────────────────────────────────────────
async function phase3() {
  console.log('\n🔄 Phase 3: 구독 상태 전이 (응답 코드 기준)');

  // 3-A: ACTIVE → TRIAL 다운그레이드 차단 시도
  const activeTs = new Date(Date.now() - 2000).toISOString();
  const trialTs  = new Date(Date.now() - 500).toISOString();
  { await postWebhookSigned(buildLsPayload({ status: 'active', updatedAt: activeTs })); const r = await postWebhookSigned(buildLsPayload({ eventName: 'subscription_updated', status: 'on_trial', updatedAt: trialTs, trialEnd: new Date(Date.now() + 7*86400_000).toISOString() })); assert('3-A downgrade 시도 → 200 (내부 DOWNGRADE_BLOCKED)', r.status === 200, `status=${r.status}`); }
  console.log(`  → [MCP 확인] subscriptions WHERE user_id='${TEST_USER_ID}' — status 여전히 ACTIVE이어야 함`);

  // 3-B: stale 이벤트 → 200 (내부 STALE_SKIPPED)
  { const newerTs = new Date(Date.now() - 1000).toISOString(); const olderTs = new Date(Date.now() - 60000).toISOString(); await postWebhookSigned(buildLsPayload({ status: 'active', updatedAt: newerTs })); const r = await postWebhookSigned(buildLsPayload({ status: 'paused', updatedAt: olderTs })); assert('3-B stale 이벤트 → 200', r.status === 200, `status=${r.status}`); }
  console.log(`  → [MCP 확인] subscriptions.status = ACTIVE (stale skip 후 변경 없어야 함)`);

  // 3-C: cancelled + future → CANCELED_AT_PERIOD_END
  const futureEnd = new Date(Date.now() + 15*86400_000).toISOString();
  { const r = await postWebhookSigned(buildLsPayload({ eventName: 'subscription_cancelled', status: 'active', cancelled: true, endsAt: futureEnd, updatedAt: new Date().toISOString() })); assert('3-C cancelled + future ends_at → 200', r.status === 200, `status=${r.status}`); }
  console.log(`  → [MCP 확인] subscriptions.status = CANCELED_AT_PERIOD_END, cancel_at_period_end = true`);

  // 3-D: cancelled + past → CANCELED
  const pastEnd = new Date(Date.now() - 86400_000).toISOString();
  { const r = await postWebhookSigned(buildLsPayload({ eventName: 'subscription_expired', status: 'cancelled', cancelled: true, endsAt: pastEnd, updatedAt: new Date(Date.now() + 5000).toISOString() })); assert('3-D cancelled + past → 200', r.status === 200, `status=${r.status}`); }
  console.log(`  → [MCP 확인] subscriptions.status = CANCELED`);

  // 3-E: paused → PAST_DUE
  { const r = await postWebhookSigned(buildLsPayload({ eventName: 'subscription_paused', status: 'paused', updatedAt: new Date(Date.now() + 10000).toISOString() })); assert('3-E paused → 200', r.status === 200, `status=${r.status}`); }

  // 3-F: active 복구 → ACTIVE
  { const r = await postWebhookSigned(buildLsPayload({ eventName: 'subscription_updated', status: 'active', updatedAt: new Date(Date.now() + 20000).toISOString() })); assert('3-F active 복구 → 200', r.status === 200, `status=${r.status}`); }
  console.log(`  → [MCP 확인] subscriptions.status = ACTIVE (복구)`);

  await sleep(800);
}

// ─────────────────────────────────────────────────────────────────────
// Phase 4: check-entitlement (쿠키 인증)
// ─────────────────────────────────────────────────────────────────────
async function phase4() {
  console.log('\n🔑 Phase 4: check-entitlement API');

  // 4-A: 현재 ACTIVE → plan/status 반영
  { const r = await fetch(`${APP_URL}/api/check-entitlement`, { headers: { Cookie: testCookie } }); const body = await r.json().catch(() => ({})); assert('4-A check-entitlement plan=pro_10',  body.plan === 'pro_10',  `plan=${body.plan}`); assert('4-A check-entitlement status=ACTIVE', body.status === 'ACTIVE', `status=${body.status}`); }

  // 4-B: CANCELED 상태로 변경 후 동일 쿠키 재조회 (DB 즉시 반영 확인)
  const pastEnd = new Date(Date.now() - 1000).toISOString();
  await postWebhookSigned(buildLsPayload({ eventName: 'subscription_cancelled', status: 'cancelled', cancelled: true, endsAt: pastEnd, updatedAt: new Date(Date.now() + 30000).toISOString() }));
  await sleep(800);
  { const r = await fetch(`${APP_URL}/api/check-entitlement`, { headers: { Cookie: testCookie } }); const body = await r.json().catch(() => ({})); assert('4-B CANCELED → check-entitlement 즉시 반영', body.status === 'CANCELED', `status=${body.status}`); }
}

// ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('=== EveryFive 결제 플로우 테스트 ===');
  console.log(`User: ${TEST_USER_ID}`);

  try {
    await login();

    // 1-C 전처리: ACTIVE 구독을 보장 (409 인증 증명 경로를 활성화)
    await postWebhookSigned(buildLsPayload({
      eventName: 'subscription_created',
      status: 'active',
      updatedAt: new Date(Date.now() - 10000).toISOString(),
    }));
    await sleep(400);

    await phase1();
    await phase2();
    await phase3();
    await phase4();
  } catch (e) {
    console.error('\n💥 예외:', e.message);
    failed++;
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`HTTP 계층: ${passed} passed, ${failed} failed`);
  if (failures.length) { console.log('\n실패:'); failures.forEach(f => console.log(`  ❌ ${f}`)); }
  console.log('\n→ DB 계층 검증: Supabase MCP execute_sql로 별도 수행');
  process.exit(failed > 0 ? 1 : 0);
})();
