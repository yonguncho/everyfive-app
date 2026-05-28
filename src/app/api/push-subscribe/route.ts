import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const MAX_BODY_BYTES = 2048;

// RFC1918 / loopback / link-local 차단 (SSRF 방지)
const PRIVATE_IP_PATTERN = new RegExp(
  '^(' +
    String.raw`10\.\d{1,3}\.\d{1,3}\.\d{1,3}` + '|' +
    String.raw`172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}` + '|' +
    String.raw`192\.168\.\d{1,3}\.\d{1,3}` + '|' +
    String.raw`127\.\d{1,3}\.\d{1,3}\.\d{1,3}` + '|' +
    String.raw`169\.254\.\d{1,3}\.\d{1,3}` + '|' +
    'localhost|::1|\\[::1\\]|\\[fe80:' +
  ')',
  'i',
);

function validatePushEndpoint(endpoint: string): { ok: false; reason: string } | { ok: true } {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'non_https_scheme' };
  }

  // userinfo (user:pass@host) 차단 — URL 혼동 공격 방지
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'userinfo_not_allowed' };
  }

  // trailing dot 정규화 후 private IP / loopback 차단
  const hostname = parsed.hostname.replace(/\.$/, '').toLowerCase();
  if (PRIVATE_IP_PATTERN.test(hostname)) {
    return { ok: false, reason: 'private_ip_not_allowed' };
  }

  return { ok: true };
}

export async function POST(req: NextRequest) {
  // Content-Length guard (DoS 방지)
  const contentLength = req.headers.get('content-length');
  if (!contentLength) {
    return NextResponse.json({ error: 'content_length_required' }, { status: 411 });
  }
  const cl = parseInt(contentLength, 10);
  if (isNaN(cl) || cl > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { subscription } = body ?? {};

  // subscription 구조 검증
  if (
    !subscription ||
    typeof subscription.endpoint !== 'string' ||
    typeof subscription.keys?.p256dh !== 'string' ||
    typeof subscription.keys?.auth !== 'string'
  ) {
    return NextResponse.json({ error: 'invalid_subscription' }, { status: 400 });
  }

  // 필드 길이 검증
  if (subscription.endpoint.length > 2048) {
    return NextResponse.json({ error: 'endpoint_too_long' }, { status: 400 });
  }
  if (subscription.keys.p256dh.length > 200) {
    return NextResponse.json({ error: 'p256dh_too_long' }, { status: 400 });
  }
  if (subscription.keys.auth.length > 100) {
    return NextResponse.json({ error: 'auth_too_long' }, { status: 400 });
  }

  // endpoint URL SSRF 검증 (private IP / userinfo 차단)
  const endpointCheck = validatePushEndpoint(subscription.endpoint);
  if (!endpointCheck.ok) {
    return NextResponse.json({ error: 'invalid_subscription', detail: endpointCheck.reason }, { status: 400 });
  }

  // SSR 방식으로 현재 user 인증
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // service_role로 profiles 업데이트 (profiles.id = auth.uid())
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: updated, error: updateErr } = await admin
    .from('profiles')
    .update({ push_subscription: subscription })
    .eq('id', user.id)
    .select('id');

  if (updateErr) {
    console.error(JSON.stringify({ event: 'push_subscribe_update_failed', userId: user.id, error: updateErr.message }));
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }

  if (!updated?.length) {
    console.error(JSON.stringify({ event: 'push_subscribe_no_row_updated', userId: user.id }));
    return NextResponse.json({ error: 'profile_not_found' }, { status: 404 });
  }

  console.log(JSON.stringify({ event: 'push_subscribed', userId: user.id }));
  return NextResponse.json({ success: true });
}
