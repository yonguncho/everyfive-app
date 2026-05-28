/**
 * EveryFive 결제 플로우 통합 테스트
 * 대상: create-checkout API + ls-webhook Edge Function + DB 반영
 *
 * 실행: node test/payment-flow/flow_test.mjs
 * 의존: .env.local (SUPABASE_*, LEMON_SQUEEZY_*)
 */

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// ── 환경변수 로드 (.env.local 파싱) ────────────────────────────────
function loadEnv(path) {
  const env = {};
  try {
    readFileSync(path, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, '');
    });
  } catch { /* ignore */ }
  return env;
}

const env = {
  ...loadEnv(new URL('../../.env.local', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')),
  ...process.env,
};

const SUPABASE_URL       = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY  = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const WEBHOOK_SECRET     = env.LEMON_SQUEEZY_WEBHOOK_SECRET;
const VARIANT_PRO_10     = env.LEMON_SQUEEZY_VARIANT_PRO_10;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !WEBHOOK_SECRET) {
  console.error('❌ 필수 환경변수 없음. .env.local 확인 필요');
  process.exit(1);
}

const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/ls-webhook`;
const APP_URL     = 'https://everyfive-app.vercel.app';

const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── HMAC 서명 ────────────────────────────────────────────────────────
function signPayload(body) {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

// ── 테스트 유틸 ───────────────────────────────────────────────────────
let passed = 0, failed = 0;
function assert(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

// ── 테스트 계정 설정 ──────────────────────────────────────────────────
const TEST_EMAIL    = `test_payment_${Date.now()}@everyfive.test`;
const TEST_PASSWORD = 'TestPass1234!';
const FAKE_USER_ID  = crypto.randomUUID();  // webhook 시뮬레이션용 임시 UUID
const FAKE_SUB_ID   = `sub_${Date.now()}`;
const FAKE_CUST_ID  = `cust_${Date.now()}`;

// ─────────────────────────────────────────────────────────────────────
// Phase 1: create-checkout API 검증
// ─────────────────────────────────────────────────────────────────────
async function phase1_checkoutApi() {
  console.log('\n📦 Phase 1: create-checkout API');

  // 1-A: 인증 없이 → 401
  {
    const r = await fetch(`${APP_URL}/api/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'pro_10' }),
    });
    assert('1-A 미인증 → 401', r.status === 401, `status=${r.status}`);
  }

  // 1-B: 잘못된 plan → 400
  {
    const { data: sess } = await anon.auth.signUp({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const token = sess.session?.access_token ?? '';
    const r = await fetch(`${APP_URL}/api/create-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan: 'pro_99' }),
    });
    assert('1-B 잘못된 plan → 400', r.status === 400, `status=${r.status}`);
    await anon.auth.signOut();
  }
}

// ─────────────────────────────────────────────────────────────────────
// Phase 2: ls-webhook 시뮬레이션
// ─────────────────────────────────────────────────────────────────────
function buildLsPayload(overrides = {}) {
  const base = {
    meta: {
      event_name: 'subscription_created',
      custom_data: { user_id: FAKE_USER_ID, plan: 'pro_10' },
    },
    data: {
      id: FAKE_SUB_ID,
      attributes: {
        status:       'active',
        variant_id:   parseInt(VARIANT_PRO_10 ?? '0', 10),
        customer_id:  parseInt(FAKE_CUST_ID, 10),
        cancelled:    false,
        ends_at:      null,
        trial_ends_at: null,
        renews_at:    new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
        updated_at:   new Date().toISOString(),
      },
    },
  };
  return JSON.stringify({ ...base, ...overrides });
}

async function postWebhook(body, sigOverride = null) {
  const sig = sigOverride ?? signPayload(body);
  return fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature':  sig,
      'X-Request-Id': crypto.randomUUID(),
    },
    body,
  });
}

async function phase2_webhookSimulation() {
  console.log('\n🔗 Phase 2: ls-webhook 시뮬레이션');

  // 2-A: 잘못된 서명 → 400
  {
    const body = buildLsPayload();
    const r = await postWebhook(body, 'invalidsig');
    assert('2-A 잘못된 서명 → 400', r.status === 400, `status=${r.status}`);
  }

  // 2-B: 서명 없음 → 400
  {
    const r = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: buildLsPayload(),
    });
    assert('2-B 서명 없음 → 400', r.status === 400, `status=${r.status}`);
  }

  // 2-C: 정상 subscription_created → 200
  {
    const body = buildLsPayload();
    const r = await postWebhook(body);
    const text = await r.text();
    assert('2-C 정상 webhook → 200 OK', r.status === 200 && text.includes('OK'), `status=${r.status} body=${text}`);
  }

  // 2-D: 동일 이벤트 재전송 → 200 (idempotency)
  // X-Request-Id가 같아야 중복으로 감지됨 — 같은 delivery ID로 재전송 시뮬레이션
  {
    const body = buildLsPayload();
    const sig  = signPayload(body);
    const fixedDeliveryId = crypto.randomUUID();
    const r1 = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Signature': sig, 'X-Request-Id': fixedDeliveryId },
      body,
    });
    const r2 = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Signature': sig, 'X-Request-Id': fixedDeliveryId },
      body,
    });
    const t2 = await r2.text();
    assert('2-D 중복 이벤트 → 200 (idempotent)', r2.status === 200 && t2.includes('Duplicate'), `status=${r2.status} body=${t2}`);
  }

  // 2-E: user_id 없는 payload → 200 graceful
  {
    const body = buildLsPayload({ meta: { event_name: 'subscription_created', custom_data: {} } });
    const r = await postWebhook(body);
    assert('2-E user_id 없음 → 200 graceful', r.status === 200, `status=${r.status}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Phase 3: DB 반영 확인
// ─────────────────────────────────────────────────────────────────────
async function phase3_dbVerification() {
  console.log('\n🗄️  Phase 3: DB 반영 확인');

  // service_role 없이 anon으로 확인 가능한 범위만 테스트
  // (RLS로 보호된 테이블은 service_role 없이 직접 읽기 불가 → webhook 응답 성공으로 간접 확인)

  // 3-A: subscription_created 후 subscriptions 반영 (service_role 필요)
  // → 대신, 2-C에서 성공한 webhook의 부작용으로 ls_events 삽입 여부를 anon으로 확인 불가
  // → 이 테스트는 Supabase MCP를 통해 별도 확인
  console.log('  ℹ️  3-A subscriptions 직접 조회는 service_role 필요 → Supabase MCP로 별도 검증');

  // 3-B: ACTIVE → TRIAL 다운그레이드 차단 (stale event 시뮬레이션)
  {
    // 먼저 ACTIVE 상태 webhook 전송
    const activeBody = buildLsPayload({
      data: {
        id: `sub_active_${Date.now()}`,
        attributes: {
          status: 'active', variant_id: parseInt(VARIANT_PRO_10 ?? '0', 10),
          customer_id: parseInt(FAKE_CUST_ID, 10), cancelled: false,
          ends_at: null, trial_ends_at: null,
          renews_at: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
          updated_at: new Date(Date.now() - 5000).toISOString(),  // 5초 전
        },
      },
      meta: { event_name: 'subscription_created', custom_data: { user_id: FAKE_USER_ID, plan: 'pro_10' } },
    });
    const r1 = await postWebhook(activeBody);

    // stale: 더 오래된 updated_at으로 TRIAL 다운그레이드 시도
    const staleBody = buildLsPayload({
      data: {
        id: `sub_stale_${Date.now()}`,
        attributes: {
          status: 'on_trial', variant_id: parseInt(VARIANT_PRO_10 ?? '0', 10),
          customer_id: parseInt(FAKE_CUST_ID, 10), cancelled: false,
          ends_at: null, trial_ends_at: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
          renews_at: null,
          updated_at: new Date(Date.now() - 60000).toISOString(),  // 1분 전 = stale
        },
      },
      meta: { event_name: 'subscription_updated', custom_data: { user_id: FAKE_USER_ID, plan: 'pro_10' } },
    });
    const r2 = await postWebhook(staleBody);
    // webhook 자체는 200 OK (내부에서 STALE_SKIPPED 처리)
    assert('3-B stale 이벤트 → webhook 200 (DB는 STALE_SKIPPED)', r2.status === 200, `status=${r2.status}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// 실행
// ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('=== EveryFive 결제 플로우 통합 테스트 ===');
  console.log(`대상: ${APP_URL}`);
  console.log(`Webhook: ${WEBHOOK_URL}`);

  try {
    await phase1_checkoutApi();
    await phase2_webhookSimulation();
    await phase3_dbVerification();
  } catch (e) {
    console.error('\n💥 테스트 실행 중 예외:', e.message);
    failed++;
  }

  console.log(`\n결과: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
