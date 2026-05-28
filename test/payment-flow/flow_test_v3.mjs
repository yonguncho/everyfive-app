/**
 * EveryFive 결제 플로우 통합 테스트 v3
 * Codex Round 2 비판 반영:
 *  - C1: 쿠키 형식 수정 → base64-<base64url(JSON)> (@supabase/ssr cookies.js:L6 BASE64_PREFIX 확인)
 *  - C2: Phase 4에 상태 변경 후 재조회 (DB vs 캐시 검증)
 *  - C3: resetSubscription에서 ls_events까지 정리
 *  - M1: pollUntil 헬퍼로 타이밍 의존성 제거
 *  - M2: Phase 3-A에서 trialTs > activeTs 내부 단언
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
  } catch { /* ignore */ }
  return env;
}

const ENV_FILE = new URL('../../.env.local', import.meta.url)
  .pathname.replace(/^\/([A-Z]:)/, '$1');
const env = { ...loadEnv(ENV_FILE), ...process.env };

const SUPABASE_URL      = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY;
const WEBHOOK_SECRET    = env.LEMON_SQUEEZY_WEBHOOK_SECRET;
const VARIANT_PRO_10    = env.LEMON_SQUEEZY_VARIANT_PRO_10 ?? '0';

const MISSING = [
  !SUPABASE_URL      && 'NEXT_PUBLIC_SUPABASE_URL',
  !SUPABASE_ANON_KEY && 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  !SERVICE_ROLE_KEY  && 'SUPABASE_SERVICE_ROLE_KEY',
  !WEBHOOK_SECRET    && 'LEMON_SQUEEZY_WEBHOOK_SECRET',
].filter(Boolean);
if (MISSING.length) {
  console.error('❌ 필수 환경변수 없음:', MISSING.join(', '));
  process.exit(1);
}

const anon  = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/ls-webhook`;
const APP_URL     = 'https://everyfive-app.vercel.app';
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const COOKIE_NAME = `sb-${PROJECT_REF}-auth-token`;

// ── 테스트 유틸 ────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    const msg = `${label}${detail ? ` — ${detail}` : ''}`;
    console.error(`  ❌ ${msg}`);
    failures.push(msg);
    failed++;
  }
}

function signPayload(body) {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

/** 조건이 참이 될 때까지 최대 deadline ms 동안 폴링 */
async function pollUntil(fn, { deadline = 8000, interval = 400 } = {}) {
  const end = Date.now() + deadline;
  while (Date.now() < end) {
    const result = await fn();
    if (result) return result;
    await new Promise(r => setTimeout(r, interval));
  }
  return null;
}

// ── 쿠키 조립 (@supabase/ssr cookies.js BASE64_PREFIX 방식) ──────────
function buildAuthCookie(session) {
  // @supabase/ssr getItem: if (chunkedCookie.startsWith('base64-')) → decode
  // So 'base64-' + base64url(JSON.stringify(session)) 형식이 서버에서 올바르게 파싱됨
  const json = JSON.stringify({
    access_token:  session.access_token,
    token_type:    session.token_type ?? 'bearer',
    expires_in:    session.expires_in,
    expires_at:    session.expires_at,
    refresh_token: session.refresh_token,
    user:          session.user,
  });
  const encoded = 'base64-' + Buffer.from(json).toString('base64url');
  // base64url 문자셋(A-Za-z0-9-_)은 쿠키 헤더에서 안전함 — URL 인코딩 불필요
  return `${COOKIE_NAME}=${encoded}`;
}

// ── 테스트 사용자 ──────────────────────────────────────────────────────
const TEST_EMAIL = `test_ef_${Date.now()}@everyfive.test`;
const TEST_PASS  = 'TestPass1234!';
let testUserId   = null;
let testCookie   = null;

async function setupTestUser() {
  const { data, error } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASS,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  testUserId = data.user.id;

  const { data: sess, error: signInErr } = await anon.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASS,
  });
  if (signInErr || !sess.session) throw new Error(`signIn: ${signInErr?.message}`);

  testCookie = buildAuthCookie(sess.session);

  // profiles 트리거 완료를 pollUntil으로 대기 (최대 8초)
  const profile = await pollUntil(async () => {
    const { data: p } = await admin.from('profiles').select('id').eq('id', testUserId).single();
    return p ?? null;
  });
  if (!profile) throw new Error(`profiles 트리거 타임아웃 (user: ${testUserId})`);

  console.log(`  → 테스트 사용자: ${testUserId}`);
}

async function cleanupTestUser() {
  if (!testUserId) return;
  // 관련 테이블 전체 정리 (ls_events는 payload 기반 삭제)
  await admin.from('subscriptions').delete().eq('user_id', testUserId);
  await admin.from('ls_events').delete().like('payload', `%${testUserId}%`);
  await admin.from('profiles').delete().eq('id', testUserId);
  await admin.auth.admin.deleteUser(testUserId);
  console.log(`  → 정리 완료: ${testUserId}`);
}

// ── webhook 헬퍼 ──────────────────────────────────────────────────────
let _subSeq = 0;
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
  subId     = `sub_${Date.now()}_${++_subSeq}`,
  custId    = '12345678',
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
        status, variant_id: variantId, customer_id: parseInt(custId, 10),
        cancelled, ends_at: endsAt, trial_ends_at: trialEnd,
        renews_at: renewsAt, updated_at: updatedAt,
      },
    },
  });
}

async function postWebhook(body, { sig, requestId = crypto.randomUUID() } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (sig !== undefined) headers['X-Signature'] = sig;
  if (requestId)         headers['X-Request-Id'] = requestId;
  return fetch(WEBHOOK_URL, { method: 'POST', headers, body });
}

function postWebhookSigned(body, opts = {}) {
  return postWebhook(body, { sig: signPayload(body), ...opts });
}

async function getSub()  {
  const { data } = await admin.from('subscriptions').select('*').eq('user_id', testUserId).single();
  return data;
}
async function getLsEvent(eventId) {
  const { data } = await admin.from('ls_events').select('*').eq('event_id', eventId).single();
  return data;
}

/** 특정 구독 status가 될 때까지 폴링 */
async function pollSubStatus(expectedStatus) {
  return pollUntil(async () => {
    const sub = await getSub();
    return sub?.status === expectedStatus ? sub : null;
  });
}

/** resetSubscription: subscriptions + 관련 ls_events 정리 */
async function resetSubscription() {
  await admin.from('subscriptions').delete().eq('user_id', testUserId);
  await admin.from('ls_events').delete().like('payload', `%${testUserId}%`);
}

// ─────────────────────────────────────────────────────────────────────
// Phase 1: create-checkout API
// ─────────────────────────────────────────────────────────────────────
async function phase1() {
  console.log('\n📦 Phase 1: create-checkout API');

  // 1-A: valid plan + 미인증 → 401
  {
    const r = await fetch(`${APP_URL}/api/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'pro_10' }),
    });
    assert('1-A valid plan + 미인증 → 401', r.status === 401, `status=${r.status}`);
  }

  // 1-B: invalid plan → 400 (auth보다 먼저 검증됨)
  {
    const r = await fetch(`${APP_URL}/api/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'pro_99' }),
    });
    assert('1-B invalid plan → 400', r.status === 400, `status=${r.status}`);
  }

  // 1-C: 쿠키 인증 + pro_10 → 200 + checkout URL
  {
    const r = await fetch(`${APP_URL}/api/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: testCookie },
      body: JSON.stringify({ plan: 'pro_10' }),
    });
    const body = await r.json().catch(() => ({}));
    const ok = r.status === 200 && typeof body.url === 'string' && body.url.startsWith('https://');
    assert('1-C 쿠키 인증 + pro_10 → 200 + checkout URL', ok,
      `status=${r.status} url=${body.url ?? JSON.stringify(body)}`);
  }

  // 1-D: ACTIVE 구독 있으면 → 409
  {
    await postWebhookSigned(buildLsPayload({ status: 'active' }));
    await pollSubStatus('ACTIVE');
    const r = await fetch(`${APP_URL}/api/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: testCookie },
      body: JSON.stringify({ plan: 'pro_20' }),
    });
    assert('1-D ACTIVE 구독 → 409', r.status === 409, `status=${r.status}`);
    await resetSubscription();
  }
}

// ─────────────────────────────────────────────────────────────────────
// Phase 2: webhook 시뮬레이션
// ─────────────────────────────────────────────────────────────────────
async function phase2() {
  console.log('\n🔗 Phase 2: ls-webhook 시뮬레이션');

  // 2-A: 서명 없음 → 400
  {
    const r = await postWebhook(buildLsPayload(), { sig: undefined, requestId: null });
    assert('2-A 서명 없음 → 400', r.status === 400, `status=${r.status}`);
  }

  // 2-B: 잘못된 서명 → 400
  {
    const r = await postWebhook(buildLsPayload(), { sig: 'deadbeef' });
    assert('2-B 잘못된 서명 → 400', r.status === 400, `status=${r.status}`);
  }

  // 2-C: 정상 subscription_created → 200 + DB 반영 확인
  {
    await resetSubscription();
    const subId = `sub_2c_${Date.now()}`;
    const requestId = crypto.randomUUID();
    const body = buildLsPayload({ subId });
    const r = await postWebhookSigned(body, { requestId });
    const text = await r.text();
    assert('2-C 정상 webhook → 200 OK', r.status === 200 && text.includes('OK'), `status=${r.status}`);

    const sub = await pollSubStatus('ACTIVE');
    assert('2-C subscriptions.status = ACTIVE', !!sub, `status=${sub?.status}`);
    assert('2-C subscriptions.plan = pro_10', sub?.plan === 'pro_10', `plan=${sub?.plan}`);
    assert('2-C ls_subscription_id 저장', sub?.ls_subscription_id === subId, `id=${sub?.ls_subscription_id}`);
    const lsEv = await getLsEvent(requestId);
    assert('2-C ls_events 삽입 확인', !!lsEv, `event_id=${requestId}`);
  }

  // 2-D: 동일 X-Request-Id 재전송 → 200 Duplicate
  {
    const fixedId = crypto.randomUUID();
    const body = buildLsPayload();
    const sig  = signPayload(body);
    await postWebhook(body, { sig, requestId: fixedId });
    const r2   = await postWebhook(body, { sig, requestId: fixedId });
    const t2   = await r2.text();
    assert('2-D 동일 X-Request-Id → Duplicate', r2.status === 200 && t2.includes('Duplicate'), `body=${t2}`);
  }

  // 2-E: X-Request-Id 없는 fallback key 중복
  {
    const sharedAt = new Date().toISOString();
    const sharedSub = `sub_2e_${Date.now()}`;
    const body = buildLsPayload({ subId: sharedSub, updatedAt: sharedAt, eventName: 'subscription_updated' });
    await postWebhookSigned(body, { requestId: null });
    const r2 = await postWebhookSigned(body, { requestId: null });
    const t2 = await r2.text();
    assert('2-E fallback key 중복 → Duplicate', r2.status === 200 && t2.includes('Duplicate'), `body=${t2}`);
  }

  // 2-F: user_id 없음 → 200 graceful
  {
    const r = await postWebhookSigned(buildLsPayload({ userId: null }));
    assert('2-F user_id 없음 → 200 graceful', r.status === 200, `status=${r.status}`);
  }

  // 2-G: invalid JSON + valid signature → 400
  {
    const badBody = '{"invalid":}';
    const r = await postWebhook(badBody, { sig: signPayload(badBody) });
    assert('2-G invalid JSON → 400', r.status === 400, `status=${r.status}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Phase 3: 상태 전이 시나리오
// ─────────────────────────────────────────────────────────────────────
async function phase3() {
  console.log('\n🔄 Phase 3: 구독 상태 전이');

  // 3-A: ACTIVE → TRIAL 다운그레이드 차단
  {
    await resetSubscription();
    const activeTs = new Date(Date.now() - 2000).toISOString();  // 2초 전
    const trialTs  = new Date(Date.now() - 500).toISOString();   // 0.5초 전 (activeTs보다 최신)

    // 내부 단언: trialTs > activeTs (stale이 아님 = downgrade block에 도달해야 함)
    assert('3-A 전제: trialTs > activeTs', new Date(trialTs) > new Date(activeTs));

    await postWebhookSigned(buildLsPayload({ status: 'active', updatedAt: activeTs }));
    await pollSubStatus('ACTIVE');

    await postWebhookSigned(buildLsPayload({
      eventName: 'subscription_updated', status: 'on_trial', updatedAt: trialTs,
      trialEnd: new Date(Date.now() + 7 * 86400_000).toISOString(),
    }));
    // 짧게 대기 후 상태 확인 (변경이 없어야 함)
    await new Promise(r => setTimeout(r, 800));
    const sub = await getSub();
    assert('3-A ACTIVE → TRIAL 다운그레이드 차단 → ACTIVE 유지', sub?.status === 'ACTIVE', `status=${sub?.status}`);
  }

  // 3-B: stale 이벤트 → STALE_SKIPPED (기존 상태 유지)
  {
    await resetSubscription();
    const newerTs = new Date(Date.now() - 1000).toISOString();
    const olderTs = new Date(Date.now() - 60000).toISOString();

    await postWebhookSigned(buildLsPayload({ status: 'active', updatedAt: newerTs }));
    await pollSubStatus('ACTIVE');

    await postWebhookSigned(buildLsPayload({ status: 'paused', updatedAt: olderTs }));
    await new Promise(r => setTimeout(r, 600));
    const sub = await getSub();
    assert('3-B stale 이벤트 → ACTIVE 유지', sub?.status === 'ACTIVE', `status=${sub?.status}`);
  }

  // 3-C: cancelled=true + future ends_at → CANCELED_AT_PERIOD_END
  {
    await resetSubscription();
    const futureEnd = new Date(Date.now() + 15 * 86400_000).toISOString();
    await postWebhookSigned(buildLsPayload({
      eventName: 'subscription_cancelled', status: 'active', cancelled: true, endsAt: futureEnd,
    }));
    const sub = await pollUntil(async () => {
      const s = await getSub();
      return s?.status === 'CANCELED_AT_PERIOD_END' ? s : null;
    });
    assert('3-C cancelled + future ends_at → CANCELED_AT_PERIOD_END', !!sub, `status=${(await getSub())?.status}`);
    assert('3-C cancel_at_period_end = true', sub?.cancel_at_period_end === true);
  }

  // 3-D: cancelled=true + past ends_at → CANCELED
  {
    await resetSubscription();
    const pastEnd = new Date(Date.now() - 86400_000).toISOString();
    await postWebhookSigned(buildLsPayload({
      eventName: 'subscription_expired', status: 'cancelled', cancelled: true, endsAt: pastEnd,
    }));
    const sub = await pollSubStatus('CANCELED');
    assert('3-D cancelled + past ends_at → CANCELED', !!sub, `status=${(await getSub())?.status}`);
  }

  // 3-E: paused → PAST_DUE
  {
    await resetSubscription();
    await postWebhookSigned(buildLsPayload({ eventName: 'subscription_paused', status: 'paused' }));
    const sub = await pollSubStatus('PAST_DUE');
    assert('3-E paused → PAST_DUE', !!sub, `status=${(await getSub())?.status}`);
  }

  // 3-F: active 복구 → ACTIVE
  {
    await postWebhookSigned(buildLsPayload({
      eventName: 'subscription_updated', status: 'active',
      updatedAt: new Date(Date.now() + 1000).toISOString(),  // 미래 ts = 스탈 아님
    }));
    const sub = await pollSubStatus('ACTIVE');
    assert('3-F 복구 → ACTIVE', !!sub, `status=${(await getSub())?.status}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Phase 4: check-entitlement — DB 기반 검증 (캐시 vs DB)
// ─────────────────────────────────────────────────────────────────────
async function phase4() {
  console.log('\n🔑 Phase 4: check-entitlement API (DB 즉시 반영)');

  // 4-A: ACTIVE → check-entitlement 반영
  {
    await resetSubscription();
    await postWebhookSigned(buildLsPayload({ status: 'active' }));
    await pollSubStatus('ACTIVE');

    const r = await fetch(`${APP_URL}/api/check-entitlement`, {
      headers: { Cookie: testCookie },
    });
    const body = await r.json().catch(() => ({}));
    assert('4-A ACTIVE → check-entitlement plan=pro_10',  body.plan === 'pro_10',  `plan=${body.plan}`);
    assert('4-A ACTIVE → check-entitlement status=ACTIVE', body.status === 'ACTIVE', `status=${body.status}`);
  }

  // 4-B: ACTIVE → CANCELED (webhook) → 동일 쿠키로 check-entitlement 재조회
  //      check-entitlement는 매번 DB SELECT → 캐시 없이 즉시 반영되어야 함
  {
    const pastEnd = new Date(Date.now() - 1000).toISOString();
    await postWebhookSigned(buildLsPayload({
      eventName: 'subscription_cancelled', status: 'cancelled', cancelled: true, endsAt: pastEnd,
      updatedAt: new Date(Date.now() + 2000).toISOString(),  // 더 최신 ts
    }));
    await pollSubStatus('CANCELED');

    // 동일 쿠키 (새 JWT 없이) — DB 갱신 즉시 반영 확인
    const r = await fetch(`${APP_URL}/api/check-entitlement`, {
      headers: { Cookie: testCookie },
    });
    const body = await r.json().catch(() => ({}));
    assert('4-B CANCELED → check-entitlement DB 즉시 반영', body.status === 'CANCELED', `status=${body.status}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('=== EveryFive 결제 플로우 통합 테스트 v3 ===');
  console.log(`Webhook: ${WEBHOOK_URL}`);
  console.log(`App:     ${APP_URL}`);

  try {
    console.log('\n🔧 테스트 사용자 준비...');
    await setupTestUser();

    await phase1();
    await phase2();
    await phase3();
    await phase4();

  } catch (e) {
    console.error('\n💥 예외:', e.message);
    failed++;
  } finally {
    console.log('\n🧹 정리...');
    await cleanupTestUser();
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`결과: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\n실패:');
    failures.forEach(f => console.log(`  ❌ ${f}`));
  }
  process.exit(failed > 0 ? 1 : 0);
})();
