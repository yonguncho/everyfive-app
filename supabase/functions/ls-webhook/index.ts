/**
 * Lemon Squeezy Webhook handler (Supabase Edge Function, Deno)
 *
 * 처리:
 *  1. HMAC-SHA256 서명 검증 (X-Signature 헤더)
 *  2. ls_events.event_id unique 체크 (idempotency)
 *  3. Ordering guard: incoming updated_at < current → skip
 *  4. Status precedence: ACTIVE > TRIAL > CANCELED_AT_PERIOD_END > CANCELED
 *  5. Realtime broadcast → 클라이언트 JWT refresh
 */

// @ts-ignore Deno imports
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
// @ts-ignore Deno imports
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// @ts-ignore Deno globals
const webhookSecret = Deno.env.get('LEMON_SQUEEZY_WEBHOOK_SECRET');
if (!webhookSecret) throw new Error('Missing LEMON_SQUEEZY_WEBHOOK_SECRET');
// @ts-ignore Deno globals
const supabaseUrl    = Deno.env.get('SUPABASE_URL')!;
// @ts-ignore Deno globals
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// variant_id → plan 슬러그 매핑 — 빈 문자열 키 제거 (env 미설정 시 pro_* 오매핑 방지)
// @ts-ignore Deno globals
const VARIANT_PLAN: Record<string, string> = Object.fromEntries(
  [
    [Deno.env.get('LEMON_SQUEEZY_VARIANT_PRO_10'), 'pro_10'],
    [Deno.env.get('LEMON_SQUEEZY_VARIANT_PRO_20'), 'pro_20'],
    [Deno.env.get('LEMON_SQUEEZY_VARIANT_PRO_30'), 'pro_30'],
  ].filter(([id]) => id)
);

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function verifySignature(body: string, sig: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/i.test(sig)) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  const sigBytes = new Uint8Array(sig.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  return crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(body));
}

function mapStatus(lsStatus: string, cancelled: boolean, endsAt: string | null): string {
  if (cancelled) {
    const ended = endsAt ? new Date(endsAt) < new Date() : true;
    return ended ? 'CANCELED' : 'CANCELED_AT_PERIOD_END';
  }
  const map: Record<string, string> = {
    on_trial: 'TRIAL',
    active:   'ACTIVE',
    paused:   'PAST_DUE',
    past_due: 'PAST_DUE',
    unpaid:   'PAST_DUE',
    cancelled:'CANCELED',
    expired:  'CANCELED',
  };
  return map[lsStatus] ?? 'NONE';
}

const MAX_WEBHOOK_BYTES = 32 * 1024; // 32KB: generous upper bound for LS subscription payloads

serve(async (req: Request) => {
  const sig = req.headers.get('X-Signature');
  if (!sig) return new Response('No signature', { status: 400 });

  const rawContentLength = req.headers.get('content-length');
  if (!rawContentLength) {
    return new Response(JSON.stringify({ error: 'content_length_required' }), {
      status: 411,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const contentLength = Number(rawContentLength);
  if (isNaN(contentLength) || contentLength > MAX_WEBHOOK_BYTES) {
    return new Response('Payload Too Large', { status: 413 });
  }

  const body = await req.text();
  // Double-check actual body size (chunked transfer may bypass Content-Length guard)
  if (new TextEncoder().encode(body).length > MAX_WEBHOOK_BYTES) {
    return new Response('Payload Too Large', { status: 413 });
  }
  if (!(await verifySignature(body, sig))) {
    return new Response('Signature verification failed', { status: 400 });
  }

  let payload: any;
  try { payload = JSON.parse(body); } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const eventName: string = payload?.meta?.event_name ?? '';
  const handledEvents = [
    'subscription_created', 'subscription_updated',
    'subscription_cancelled', 'subscription_expired',
    'subscription_paused', 'subscription_unpaused',
  ];
  if (!handledEvents.includes(eventName)) {
    return new Response('OK', { status: 200 });
  }

  // idempotency key: X-Request-Id(LS 배달 ID) 우선, 없으면 event+subId+updated_at 합성
  // subscription_updated는 같은 subId로 여러 번 오므로 updated_at을 포함해야 중복 감지 가능
  const deliveryId = req.headers.get('X-Request-Id') ?? '';
  const subId      = String(payload?.data?.id ?? '');
  const updatedAt  = payload?.data?.attributes?.updated_at ?? '';
  const eventId    = deliveryId || `${eventName}:${subId}:${updatedAt}`;

  const { error: insertErr } = await supabase
    .from('ls_events')
    .insert({ event_id: eventId, event_type: eventName, created_at: new Date().toISOString(), payload });
  if (insertErr) {
    if (insertErr.code === '23505') return new Response('Duplicate event ignored', { status: 200 });
    console.error('ls_idempotency_insert_failed', insertErr);
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const attrs      = payload.data.attributes;
  const customData = payload.meta?.custom_data ?? {};
  const userId: string | null = customData.user_id ?? null;
  if (!userId) { console.warn('no user_id', eventId); return new Response('No user_id', { status: 200 }); }
  // UUID 형식 검증 — SECURITY DEFINER RPC에 비검증 문자열 전달 방지
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    console.warn('invalid user_id format', eventId);
    return new Response('Invalid user_id', { status: 400 });
  }

  // variant_id가 number/string이 아닌 경우(예: {}) String() 변환 시 '[object Object]'로 coerce됨 — 명시적 타입 검증
  const rawVariantId = attrs.variant_id;
  if (typeof rawVariantId !== 'number' && typeof rawVariantId !== 'string') {
    console.warn(JSON.stringify({ event: 'invalid_variant_id_type', type: typeof rawVariantId, eventId }));
    return new Response('Invalid variant_id', { status: 400 });
  }
  const variantId = String(rawVariantId);
  // Reject unknown variant: falling back to 'free' would create a wrong subscription record.
  // Return 200 (not 400) to prevent Lemon Squeezy retries for legitimately unhandled variants.
  const plan = VARIANT_PLAN[variantId];
  if (!plan) {
    console.warn(JSON.stringify({ event: 'unknown_variant_id', variantId, eventId }));
    return new Response('Unknown variant: skipped', { status: 200 });
  }
  const lsStatus  = attrs.status ?? '';
  const cancelled = attrs.cancelled ?? false;
  const endsAt    = attrs.ends_at ?? null;
  const status    = mapStatus(lsStatus, cancelled, endsAt);
  const cancelAtEnd = cancelled && endsAt && new Date(endsAt) > new Date();

  const { data: result, error: rpcErr } = await supabase.rpc('upsert_subscription_with_guard', {
    p_user_id:              userId,
    p_ls_customer_id:       String(attrs.customer_id ?? ''),
    p_ls_subscription_id:   String(payload.data.id ?? ''),
    p_plan:                 plan,
    p_status:               status,
    p_current_period_end:   attrs.renews_at ?? attrs.ends_at ?? null,
    p_trial_end:            attrs.trial_ends_at ?? null,
    p_cancel_at_period_end: !!cancelAtEnd,
    p_ls_event_ts:          attrs.updated_at ?? new Date().toISOString(),
  });

  if (rpcErr) {
    console.error('subscription_upsert_failed', rpcErr);
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log(`Subscription upsert: ${result}`);

  await supabase.channel(`entitlement:${userId}`).send({
    type: 'broadcast', event: 'subscription_update',
    payload: { plan, status, cancel_at_period_end: !!cancelAtEnd },
  });

  return new Response('OK', { status: 200 });
});
