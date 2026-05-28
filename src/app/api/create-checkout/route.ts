/**
 * Lemon Squeezy Checkout 세션 생성 (APO 패턴, 직접 fetch)
 * PRD FR-10: FREE → TRIAL (7일) → ACTIVE
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const LS_API = 'https://api.lemonsqueezy.com/v1';
const LS_KEY = process.env.LEMON_SQUEEZY_API_KEY!;

const PLAN_VARIANT_IDS: Record<string, string> = {
  pro_10: process.env.LEMON_SQUEEZY_VARIANT_PRO_10 ?? '',
  pro_20: process.env.LEMON_SQUEEZY_VARIANT_PRO_20 ?? '',
  pro_30: process.env.LEMON_SQUEEZY_VARIANT_PRO_30 ?? '',
};

export async function POST(req: NextRequest) {
  // CSRF 방어: Origin 헤더가 있으면 앱 URL과 일치해야 함 (브라우저 cross-site POST 차단)
  const reqOrigin = req.headers.get('origin');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (reqOrigin && appUrl && reqOrigin !== appUrl) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (!LS_KEY || !process.env.LEMON_SQUEEZY_STORE_ID) {
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }

  let plan: string;
  try {
    const body = await req.json();
    const rawPlan = body?.plan;
    if (typeof rawPlan !== 'string' || !rawPlan) {
      return NextResponse.json({ error: 'invalid_plan' }, { status: 400 });
    }
    plan = rawPlan;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const variantId = PLAN_VARIANT_IDS[plan];
  if (!variantId) return NextResponse.json({ error: 'invalid_plan' }, { status: 400 });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll().map((c) => ({ name: c.name, value: c.value })); },
        setAll() {},
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // 비-terminal 구독 중복 차단
  const { data: sub } = await supabase
    .from('subscriptions').select('status').eq('user_id', user.id).single();
  if (sub && ['ACTIVE', 'TRIAL', 'CANCELED_AT_PERIOD_END', 'PAST_DUE'].includes(sub.status)) {
    return NextResponse.json({ error: 'already_subscribed', status: sub.status }, { status: 409 });
  }

  // A3: 원자적 idempotency guard — 60초 내 중복 checkout 요청 차단.
  // SECURITY DEFINER RPC 사용: 직접 profiles UPDATE는 RLS bypass(컬럼 null 리셋) 취약점 있음.
  const { data: acquired, error: lockErr } = await supabase.rpc('acquire_checkout_lock', { p_user_id: user.id });
  if (lockErr) {
    console.error(JSON.stringify({ event: 'acquire_checkout_lock_failed', user_id_prefix: user.id.slice(0, 8), error: lockErr }));
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }
  if (!acquired) {
    return NextResponse.json({ error: 'checkout_in_progress' }, { status: 409 });
  }

  // A2: req.url origin은 프록시 헤더 조작 가능 — 환경변수만 사용 (fallback 없음)
  // https 프로토콜 강제: 잘못된 env 설정으로 http:// redirect URL이 LS에 전달되는 것을 방지
  const rawOrigin = process.env.NEXT_PUBLIC_APP_URL;
  const isValidOrigin = rawOrigin &&
    (rawOrigin.startsWith('https://') || (process.env.NODE_ENV === 'development' && rawOrigin.startsWith('http://')));
  if (!isValidOrigin) {
    console.error(JSON.stringify({ event: 'checkout_misconfigured', reason: 'NEXT_PUBLIC_APP_URL missing or non-https' }));
    return NextResponse.json({ error: 'service_misconfigured' }, { status: 500 });
  }
  const origin = rawOrigin;
  const storeId = process.env.LEMON_SQUEEZY_STORE_ID!;

  const ctrl = new AbortController();
  const abortTimer = setTimeout(() => ctrl.abort(), 8000);
  let lsRes: Response;
  try {
    lsRes = await fetch(`${LS_API}/checkouts`, {
    method: 'POST',
    signal: ctrl.signal,
    headers: {
      Authorization: `Bearer ${LS_KEY}`,
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
    },
    body: JSON.stringify({
      data: {
        type: 'checkouts',
        attributes: {
          checkout_data: {
            email: user.email,
            custom: { user_id: user.id, plan },
          },
          product_options: {
            redirect_url: `${origin}/subscription?success=1`,
            receipt_link_url: `${origin}/subscription?success=1`,
          },
        },
        relationships: {
          store:   { data: { type: 'stores',   id: storeId } },
          variant: { data: { type: 'variants', id: variantId } },
        },
      },
    }),
  });
  } catch (fetchErr: any) {
    clearTimeout(abortTimer);
    const isTimeout = fetchErr?.name === 'AbortError';
    console.error(JSON.stringify({ event: 'ls_checkout_fetch_failed', reason: isTimeout ? 'timeout' : fetchErr?.message, plan, user_id_prefix: user.id.slice(0, 8) }));
    return NextResponse.json({ error: isTimeout ? 'checkout_timeout' : 'checkout_create_failed' }, { status: 502 });
  } finally {
    clearTimeout(abortTimer);
  }

  if (!lsRes.ok) {
    const errBody = await lsRes.text();
    console.error(JSON.stringify({
      event: 'ls_checkout_create_failed',
      status: lsRes.status,
      plan,
      user_id_prefix: user.id.slice(0, 8),
      error: errBody.slice(0, 500),
    }));
    return NextResponse.json({ error: 'checkout_create_failed' }, { status: 502 });
  }

  let checkoutData: any;
  try {
    checkoutData = await lsRes.json();
  } catch {
    console.error(JSON.stringify({ event: 'ls_checkout_parse_failed', plan, user_id_prefix: user.id.slice(0, 8) }));
    return NextResponse.json({ error: 'checkout_parse_failed' }, { status: 502 });
  }
  const checkoutUrl: string = checkoutData?.data?.attributes?.url ?? '';
  if (!checkoutUrl) return NextResponse.json({ error: 'no_checkout_url' }, { status: 502 });

  return NextResponse.json({ url: checkoutUrl });
}
