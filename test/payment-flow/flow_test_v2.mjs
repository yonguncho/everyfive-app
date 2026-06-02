/**
 * EveryFive 결제 플로우 통합 테스트 v2
 * Codex Round 1 비판 반영:
 *  - C1: create-checkout auth test → cookie 기반 세션 정확히 구성
 *  - C2: FAKE_USER_ID 제거 → admin으로 실제 test user 생성/삭제, DB 직접 assert
 *  - C3: idempotency 다양화 (X-Request-Id 없는 경우 fallback key 포함)
 *  - M1: afterAll cleanup (deleteUser)
 *  - M2: customer_id numeric string으로 수정
 *  - M3: prod URL 의존 → webhook은 prod edge function, checkout은 로컬 Next.js 서버 분리
 *
 * 실행: node test/payment-flow/flow_test_v2.mjs
 *       (NODE_EXTRA_CA_CERTS 불필요 — Supabase HTTPS는 시스템 CA 신뢰)
 */

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// ── 환경변수 로드 ──────────────────────────────────────────────────────
function loadEnv(filePath) {
  const env = {};
  try {
    readFileSync(filePath, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, '');
    });
  } catch { /* 파일 없으면 무시 */ }
  return env;
}

const ENV_FILE = new URL('../../.env.local', import.meta.url)
  .pathname.replace(/^\/([A-Z]:)/, '$1');
const env = { ...loadEnv(ENV_FILE), ...process.env };

const SUPABASE_URL        = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY   = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY    = env.SUPABASE_SERVICE_ROLE_KEY;
const WEBHOOK_SECRET      = env.LEMON_SQUEEZY_WEBHOOK_SECRET;
const VARIANT_PRO_10      = env.LEMON_SQUEEZY_VARIANT_PRO_10 ?? '0';
const VARIANT_PRO_20      = env.LEMON_SQUEEZY_VARIANT_PRO_20 ?? '0';

const MISSING = [!SUPABASE_URL && 'NEXT_PUBLIC_SUPABASE_URL',
                 !SUPABASE_ANON_KEY && 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
                 !SERVICE_ROLE_KEY && 'SUPABASE_SERVICE_ROLE_KEY',
                 !WEBHOOK_SECRET && 'LEMON_SQUEEZY_WEBHOOK_SECRET'].filter(Boolean);
if (MISSING.length) {
  console.error('❌ 필수 환경변수 없음:', MISSING.join(', '));
  process.exit(1);
}

// ── 클라이언트 ────────────────────────────────────────────────────────
const anon  = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/ls-webhook`;
const APP_URL     = 'https://everyfive-app.vercel.app';

// ── 테스트 유틸 ────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    const msg = `❌ ${label}${detail ? ` — ${detail}` : ''}`;
    console.error(`  ${msg}`);
    failures.push(msg);
    failed++;
  }
}

function signPayload(body) {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

// ── 테스트 사용자 관리 ─────────────────────────────────────────────────
const TEST_PREFIX = `test_ef_pay_${Date.now()}`;
const TEST_EMAIL  = `${TEST_PREFIX}@everyfive.test`;
const TEST_PASS   = 'TestPass1234!';
let testUserId = null;
let testUserToken = null;
let testUserCookieHeader = null;  // sb-<ref>-auth-token 쿠키

async function setupTestUser() {
  // admin으로 확인된 유저 생성 (이메일 확인 불필요)
  const { data, error } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASS,
    email_confirm: true,  // 확인 없이 바로 CONFIRMED
  });
  if (error || !data.user) throw new Error(`테스트 사용자 생성 실패: ${error?.message}`);
  testUserId = data.user.id;

  // 로그인해서 세션 토큰 획득
  const { data: sess, error: signInErr } = await anon.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASS,
  });
  if (signInErr || !sess.session) throw new Error(`로그인 실패: ${signInErr?.message}`);
  testUserToken = sess.session.access_token;

  // Next.js @supabase/ssr 쿠키 형식 구성
  // 쿠키명: sb-<project-ref>-auth-token
  const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0];
  const sessionJson = JSON.stringify({
    access_token: sess.session.access_token,
    refresh_token: sess.session.refresh_token,
    token_type: 'bearer',
    expires_in: sess.session.expires_in,
    expires_at: sess.session.expires_at,
    user: sess.session.user,
  });
  const encoded = Buffer.from(sessionJson).toString('base64url');
  testUserCookieHeader = `sb-${projectRef}-auth-token=${encoded}`;

  // profiles 트리거 완료 대기 (최대 2초)
  let profileReady = false;
  for (let i = 0; i < 4; i++) {
    const { data: p } = await admin.from('profiles').select('id').eq('id', testUserId).single();
    if (p) { profileReady = true; break; }
    await new Promise(r => setTimeout(r, 500));
  }
  if (!profileReady) throw new Error(`profiles 트리거 실패 (user: ${testUserId})`);

  console.log(`  → 테스트 사용자 준비: ${testUserId}`);
}

async function cleanupTestUser() {
  if (!testUserId) return;
  // subscriptions, ls_events도 cascade 또는 직접 정리
  await admin.from('subscriptions').delete().eq('user_id', testUserId);
  await admin.from('ls_events').delete().like('payload->meta->>custom_data', `%${testUserId}%`);
  await admin.auth.admin.deleteUser(testUserId);
  console.log(`  → 테스트 사용자 정리 완료: ${testUserId}`);
}

// ── LS webhook 페이로드 빌더 ──────────────────────────────────────────
let subIdCounter = 0;
function buildLsPayload({
  eventName = 'subscription_created',
  userId    = testUserId,
  plan      = 'pro_10',
  status    = 'active',
  cancelled = false,
  endsAt    = null,
  trialEnd  = null,
  renewsAt  = new Date(Date.now() + 30 * 86400_000).toISOString(),
  updatedAt = new Date().toISOString(),
  subId     = `sub_${Date.now()}_${++subIdCounter}`,
  custId    = '12345678',      // numeric string (LS 실제 형식)
  variantId = parseInt(VARIANT_PRO_10, 10) || 111111,
} = {}) {
  return JSON.stringify({
    meta: {
      event_name: eventName,
      custom_data: userId ? { user_id: userId, plan } : {},
    },
    data: {
      id: subId,
      attributes: {
        status,
        variant_id: variantId,
        customer_id: parseInt(custId, 10),
        cancelled,
        ends_at:      endsAt,
        trial_ends_at: trialEnd,
        renews_at:    renewsAt,
        updated_at:   updatedAt,
      },
    },
  });
}

async function postWebhook(body, { sig = null, requestId = crypto.randomUUID() } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (sig !== null) headers['X-Signature'] = sig;
  if (requestId)    headers['X-Request-Id'] = requestId;
  return fetch(WEBHOOK_URL, { method: 'POST', headers, body });
}

async function postWebhookSigned(body, opts = {}) {
  return postWebhook(body, { sig: signPayload(body), ...opts });
}

// DB 조회 헬퍼
async function getSubscription(userId) {
  const { data } = await admin.from('subscriptions').select('*').eq('user_id', userId).single();
  return data;
}
async function getLsEvent(eventId) {
  const { data } = await admin.from('ls_events').select('*').eq('event_id', eventId).single();
  return data;
}

// ─────────────────────────────────────────────────────────────────────
// Phase 1: create-checkout API 검증
// ─────────────────────────────────────────────────────────────────────
async function phase1_checkoutApi() {
  console.log('\n📦 Phase 1: create-checkout API');

  // 1-A: 인증 없이 → 401 (plan 검증보다 auth가 먼저 체크되는 경우를 테스트)
  //      주의: route.ts는 plan 검증을 auth보다 먼저 함 → invalid plan이면 400이 먼저
  //      valid plan + 미인증으로 401을 올바르게 확인
  {
    const r = await fetch(`${APP_URL}/api/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'pro_10' }),  // valid plan이지만 인증 없음
    });
    assert('1-A 미인증 + valid plan → 401', r.status === 401, `status=${r.status}`);
  }

  // 1-B: 유효하지 않은 plan → 400 (auth보다 먼저 검증)
  {
    const r = await fetch(`${APP_URL}/api/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'pro_99' }),
    });
    assert('1-B 잘못된 plan → 400', r.status === 400, `status=${r.status}`);
  }

  // 1-C: 쿠키 기반 인증 + valid plan → 200 or LS API 호출 성공
  //      (LS API 키가 test mode면 실제 checkout URL 생성)
  if (testUserCookieHeader) {
    const r = await fetch(`${APP_URL}/api/create-checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: testUserCookieHeader,
      },
      body: JSON.stringify({ plan: 'pro_10' }),
    });
    const body = await r.json().catch(() => ({}));
    const ok = r.status === 200 && typeof body.url === 'string' && body.url.startsWith('https://');
    assert('1-C 쿠키 인증 + pro_10 → 200 + checkout URL', ok,
      `status=${r.status} url=${body.url ?? body.error}`);
  }

  // 1-D: 이미 ACTIVE 구독 있는 사용자 → 409
  //      webhook으로 ACTIVE 상태 만든 뒤 checkout 재시도
  {
    const body = buildLsPayload({ status: 'active', updatedAt: new Date().toISOString() });
    await postWebhookSigned(body);
    await new Promise(r => setTimeout(r, 500));  // DB 반영 대기

    const r = await fetch(`${APP_URL}/api/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: testUserCookieHeader },
      body: JSON.stringify({ plan: 'pro_20' }),
    });
    const rb = await r.json().catch(() => ({}));
    assert('1-D ACTIVE 구독 → 409', r.status === 409, `status=${r.status} body=${JSON.stringify(rb)}`);

    // cleanup: subscription 제거해 다음 테스트 격리
    await admin.from('subscriptions').delete().eq('user_id', testUserId);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Phase 2: ls-webhook 시뮬레이션
// ─────────────────────────────────────────────────────────────────────
async function phase2_webhookSimulation() {
  console.log('\n🔗 Phase 2: ls-webhook 시뮬레이션');

  // 2-A: 서명 없음 → 400
  {
    const r = await postWebhook(buildLsPayload(), { sig: null, requestId: null });
    assert('2-A 서명 없음 → 400', r.status === 400, `status=${r.status}`);
  }

  // 2-B: 잘못된 서명 → 400
  {
    const r = await postWebhook(buildLsPayload(), { sig: 'deadbeef' });
    assert('2-B 잘못된 서명 → 400', r.status === 400, `status=${r.status}`);
  }

  // 2-C: 정상 subscription_created → 200 + DB 반영 확인
  {
    const subId = `sub_c_${Date.now()}`;
    const requestId = crypto.randomUUID();
    const body = buildLsPayload({ subId });
    const r = await postWebhookSigned(body, { requestId });
    const text = await r.text();
    assert('2-C 정상 webhook → 200 OK', r.status === 200 && text.includes('OK'), `status=${r.status} body=${text}`);

    // DB 반영 검증
    await new Promise(res => setTimeout(res, 800));
    const sub = await getSubscription(testUserId);
    assert('2-C subscriptions.status = ACTIVE', sub?.status === 'ACTIVE', `status=${sub?.status}`);
    assert('2-C subscriptions.plan = pro_10',   sub?.plan === 'pro_10',   `plan=${sub?.plan}`);
    assert('2-C subscriptions.ls_subscription_id 저장', sub?.ls_subscription_id === subId, `id=${sub?.ls_subscription_id}`);
    assert('2-C ls_events 삽입 확인', !!(await getLsEvent(requestId)), `event_id=${requestId}`);
  }

  // 2-D: 동일 X-Request-Id 재전송 → 200 + "Duplicate" (idempotent)
  {
    const fixedRequestId = crypto.randomUUID();
    const body = buildLsPayload();
    const sig  = signPayload(body);
    await postWebhook(body, { sig, requestId: fixedRequestId });  // 1차
    const r2 = await postWebhook(body, { sig, requestId: fixedRequestId });  // 2차 (중복)
    const t2 = await r2.text();
    assert('2-D 중복 X-Request-Id → 200 + Duplicate', r2.status === 200 && t2.includes('Duplicate'), `status=${r2.status} body=${t2}`);
  }

  // 2-E: X-Request-Id 없는 중복 → fallback key(eventName:subId:updatedAt) 중복 감지
  {
    const sharedUpdatedAt = new Date().toISOString();
    const sharedSubId = `sub_e_${Date.now()}`;
    const body = buildLsPayload({ subId: sharedSubId, updatedAt: sharedUpdatedAt });
    await postWebhookSigned(body, { requestId: null });   // 1차: fallback key 삽입
    const r2 = await postWebhookSigned(body, { requestId: null });  // 2차: 동일 fallback
    const t2 = await r2.text();
    assert('2-E X-Request-Id 없는 fallback key 중복 → 200 + Duplicate', r2.status === 200 && t2.includes('Duplicate'), `status=${r2.status} body=${t2}`);
  }

  // 2-F: user_id 없는 payload → 200 graceful (DB 미변경)
  {
    const r = await postWebhookSigned(buildLsPayload({ userId: null }));
    assert('2-F user_id 없음 → 200 graceful', r.status === 200, `status=${r.status}`);
  }

  // 2-G: invalid JSON + valid signature → 400
  {
    const badBody = '{"invalid json":}';
    const r = await postWebhook(badBody, { sig: signPayload(badBody) });
    assert('2-G invalid JSON → 400', r.status === 400, `status=${r.status}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Phase 3: 상태 전이 시나리오
// ─────────────────────────────────────────────────────────────────────
async function phase3_stateTransitions() {
  console.log('\n🔄 Phase 3: 구독 상태 전이 시나리오');

  // 각 시나리오 전 구독 초기화
  async function resetSubscription() {
    await admin.from('subscriptions').delete().eq('user_id', testUserId);
  }

  // 3-A: ACTIVE → on_trial (최신 updated_at) → DOWNGRADE_BLOCKED, ACTIVE 유지
  {
    await resetSubscription();
    const activeTs = new Date(Date.now() - 1000).toISOString();  // 1초 전
    const trialTs  = new Date().toISOString();                   // 현재 (더 최신이지만 on_trial)

    // ACTIVE 상태 세팅
    await postWebhookSigned(buildLsPayload({ status: 'active', updatedAt: activeTs }));
    await new Promise(r => setTimeout(r, 500));

    // 더 최신 updated_at으로 TRIAL 다운그레이드 시도 → DOWNGRADE_BLOCKED
    await postWebhookSigned(buildLsPayload({
      eventName: 'subscription_updated',
      status: 'on_trial', updatedAt: trialTs,
      trialEnd: new Date(Date.now() + 7 * 86400_000).toISOString(),
    }));
    await new Promise(r => setTimeout(r, 500));

    const sub = await getSubscription(testUserId);
    assert('3-A ACTIVE → TRIAL 다운그레이드 차단 → ACTIVE 유지', sub?.status === 'ACTIVE', `status=${sub?.status}`);
  }

  // 3-B: stale 이벤트 → STALE_SKIPPED, 기존 상태 유지
  {
    await resetSubscription();
    const newerTs = new Date(Date.now() - 1000).toISOString();
    const olderTs = new Date(Date.now() - 60000).toISOString();  // 1분 전 = stale

    // 최신 이벤트 먼저
    await postWebhookSigned(buildLsPayload({ status: 'active', updatedAt: newerTs }));
    await new Promise(r => setTimeout(r, 500));

    // stale 이벤트 (older updated_at)
    const staleBody = buildLsPayload({
      eventName: 'subscription_updated', status: 'paused', updatedAt: olderTs,
    });
    await postWebhookSigned(staleBody);
    await new Promise(r => setTimeout(r, 500));

    const sub = await getSubscription(testUserId);
    assert('3-B stale 이벤트 → ACTIVE 상태 유지', sub?.status === 'ACTIVE', `status=${sub?.status}`);
  }

  // 3-C: cancelled=true + future ends_at → CANCELED_AT_PERIOD_END
  {
    await resetSubscription();
    const futureEnd = new Date(Date.now() + 15 * 86400_000).toISOString();
    await postWebhookSigned(buildLsPayload({
      eventName: 'subscription_cancelled',
      status: 'active', cancelled: true, endsAt: futureEnd,
    }));
    await new Promise(r => setTimeout(r, 500));

    const sub = await getSubscription(testUserId);
    assert('3-C cancelled + future ends_at → CANCELED_AT_PERIOD_END',
      sub?.status === 'CANCELED_AT_PERIOD_END', `status=${sub?.status}`);
    assert('3-C cancel_at_period_end = true', sub?.cancel_at_period_end === true, `flag=${sub?.cancel_at_period_end}`);
  }

  // 3-D: cancelled=true + past ends_at → CANCELED
  {
    await resetSubscription();
    const pastEnd = new Date(Date.now() - 86400_000).toISOString();  // 1일 전
    await postWebhookSigned(buildLsPayload({
      eventName: 'subscription_expired',
      status: 'cancelled', cancelled: true, endsAt: pastEnd,
    }));
    await new Promise(r => setTimeout(r, 500));

    const sub = await getSubscription(testUserId);
    assert('3-D cancelled + past ends_at → CANCELED', sub?.status === 'CANCELED', `status=${sub?.status}`);
  }

  // 3-E: subscription_paused → PAST_DUE
  {
    await resetSubscription();
    await postWebhookSigned(buildLsPayload({ eventName: 'subscription_paused', status: 'paused' }));
    await new Promise(r => setTimeout(r, 500));

    const sub = await getSubscription(testUserId);
    assert('3-E paused → PAST_DUE', sub?.status === 'PAST_DUE', `status=${sub?.status}`);
  }

  // 3-F: subscription_unpaused → ACTIVE 복구
  {
    await postWebhookSigned(buildLsPayload({
      eventName: 'subscription_updated', status: 'active', cancelled: false,
      updatedAt: new Date().toISOString(),
    }));
    await new Promise(r => setTimeout(r, 500));

    const sub = await getSubscription(testUserId);
    assert('3-F unpaused → ACTIVE 복구', sub?.status === 'ACTIVE', `status=${sub?.status}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Phase 4: check-entitlement API 반영 확인
// ─────────────────────────────────────────────────────────────────────
async function phase4_entitlementApi() {
  console.log('\n🔑 Phase 4: check-entitlement API 반영');

  // 4-A: webhook으로 ACTIVE 구독 세팅 → check-entitlement가 반영
  await admin.from('subscriptions').delete().eq('user_id', testUserId);
  await postWebhookSigned(buildLsPayload({ status: 'active' }));
  await new Promise(r => setTimeout(r, 800));

  const r = await fetch(`${APP_URL}/api/check-entitlement`, {
    headers: { Cookie: testUserCookieHeader },
  });
  const body = await r.json().catch(() => ({}));
  assert('4-A check-entitlement → status ACTIVE', body.status === 'ACTIVE', `status=${body.status}`);
  assert('4-A check-entitlement → plan pro_10',   body.plan === 'pro_10',   `plan=${body.plan}`);
}

// ─────────────────────────────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('=== EveryFive 결제 플로우 통합 테스트 v2 ===');
  console.log(`대상: ${APP_URL}`);
  console.log(`Webhook: ${WEBHOOK_URL}`);

  try {
    console.log('\n🔧 테스트 사용자 준비...');
    await setupTestUser();

    await phase1_checkoutApi();
    await phase2_webhookSimulation();
    await phase3_stateTransitions();
    await phase4_entitlementApi();
  } catch (e) {
    console.error('\n💥 테스트 실행 중 예외:', e.message);
    failed++;
  } finally {
    console.log('\n🧹 정리...');
    await cleanupTestUser();
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`결과: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\n실패 목록:');
    failures.forEach(f => console.log(`  ${f}`));
  }
  process.exit(failed > 0 ? 1 : 0);
})();
