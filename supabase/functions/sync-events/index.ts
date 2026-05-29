/**
 * sync-events Edge Function
 * Architecture v4 Section 3.1 + 5.1 + FR-13
 *
 * 처리:
 *  1. JWT에서 user_id 직접 추출 (verify_jwt=true 게이트웨이가 서명 검증 완료)
 *  2. Max 50 events/batch (초과 시 400)
 *  3. idempotent_id dedupe (DB unique constraint)
 *  4. Clock skew validation: ±24h → effective_activity_date_kst 계산
 *  5. events INSERT (lock 없이, append-only)
 *  6. Group by (user_id, word_id) → bounded retry SELECT FOR UPDATE SKIP LOCKED (3회 × 100ms)
 *  7. user_word_state UPDATE (SM-2 incremental delta)
 *  8. session_end 이벤트 시 streak 업데이트
 *  9. partial accept response
 */

// @ts-ignore Deno imports
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
// @ts-ignore Deno imports
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// @ts-ignore Deno globals
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
// @ts-ignore Deno globals
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MAX_BATCH = 50;
const MAX_BODY_BYTES = 64 * 1024; // 64KB: 50 events × ~1KB each with headroom
const CLOCK_SKEW_MAX_MS = 24 * 60 * 60 * 1000;
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

// Must stay in sync with events.event_type CHECK constraint in 001_initial_schema.sql
const VALID_EVENT_TYPES = new Set(['word_learned', 'pronunciation_attempt', 'review_completed', 'session_start', 'session_end']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LearningEvent {
  idempotent_id: string;
  user_id: string;
  device_id: string;
  event_type: string;
  word_id?: string;
  payload: any;
  client_timestamp: string;
}

function validateEvent(ev: any): string | null {
  if (typeof ev?.idempotent_id !== 'string' || !ev.idempotent_id) return 'missing_idempotent_id';
  if (typeof ev?.user_id !== 'string' || !ev.user_id) return 'missing_user_id';
  if (typeof ev?.device_id !== 'string' || !ev.device_id) return 'missing_device_id';
  if (!VALID_EVENT_TYPES.has(ev?.event_type)) return 'invalid_event_type';
  if (typeof ev?.client_timestamp !== 'string') return 'missing_client_timestamp';
  if (isNaN(new Date(ev.client_timestamp).getTime())) return 'invalid_timestamp';
  if (ev.word_id !== undefined && (typeof ev.word_id !== 'string' || !UUID_RE.test(ev.word_id))) return 'invalid_word_id';
  if (ev.payload !== undefined && (typeof ev.payload !== 'object' || Array.isArray(ev.payload))) return 'invalid_payload';
  if (ev.payload !== undefined && JSON.stringify(ev.payload).length > 4096) return 'payload_too_large';
  return null;
}

interface SyncResponse {
  accepted: string[];
  rejected: { idempotent_id: string; reason: string; retry_after_seconds?: number }[];
  updated_state: any[];
}

function toKstDate(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function computeEffectiveDate(clientTs: string, now: Date): string {
  const ct = new Date(clientTs);
  const skewMs = Math.abs(ct.getTime() - now.getTime());
  if (skewMs > CLOCK_SKEW_MAX_MS) return toKstDate(now);
  return toKstDate(ct);
}

// @ts-ignore Deno globals
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
// @ts-ignore Deno globals
const ALLOWED_ORIGIN = Deno.env.get('NEXT_PUBLIC_APP_URL') ?? '';

function getCorsHeaders(origin: string | null): Record<string, string> {
  // Only echo back origin if it exactly matches the configured app URL; otherwise omit the header
  // WHY: wildcard CORS with Authorization headers is blocked by browsers anyway, but an explicit
  // allowlist prevents cross-origin preflight approval for untrusted origins.
  const allowedOrigin = origin && ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Vary': 'Origin',
  };
}

async function verifyJwtAndGetUserId(authHeader: string): Promise<string | null> {
  try {
    if (!/^Bearer\s+\S+$/.test(authHeader)) return null;
    const token = authHeader.slice(7).trim();
    const verifier = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error } = await verifier.auth.getUser();
    if (error || !user) return null;
    return user.id;
  } catch (e) {
    console.warn(JSON.stringify({ event: 'jwt_verify_unexpected_error', error: String(e) }));
    return null;
  }
}

async function updateStreak(admin: any, userId: string, todayKst: string): Promise<void> {
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('current_streak, last_active_at')
    .eq('id', userId)
    .single();

  if (profileErr && profileErr.code !== 'PGRST116') {
    // Real DB error (not "no rows") — bail to avoid resetting streak on transient failure
    console.error(JSON.stringify({ event: 'streak_profile_select_failed', userId, error: profileErr }));
    return;
  }

  const lastActive: string | null = profile?.last_active_at ?? null;
  const currentStreak: number = profile?.current_streak ?? 0;

  if (lastActive === todayKst) return;  // 오늘 이미 카운트됨

  // UTC-safe 날짜 산술 (Deno 로컬 TZ 영향 방지)
  const [y, m, d] = todayKst.split('-').map(Number);
  const yesterdayStr = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);

  const newStreak = lastActive === yesterdayStr ? currentStreak + 1 : 1;

  const { error: streakErr } = await admin
    .from('profiles')
    .update({ current_streak: newStreak, last_active_at: todayKst })
    .eq('id', userId);
  if (streakErr) {
    console.error(JSON.stringify({ event: 'streak_update_failed', userId, error: streakErr }));
  }
}

serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  // Supabase auth.getUser()로 서버 측 JWT 서명 검증 (decode-only 방식 대비 안전)
  const userId = await verifyJwtAndGetUserId(authHeader);
  if (!userId) return new Response('Unauthorized', { status: 401 });

  // Reject if Content-Length absent: prevents unbounded body reads (DoS via chunked/no-header requests)
  const rawContentLength = req.headers.get('content-length');
  if (!rawContentLength) {
    return new Response(JSON.stringify({ error: 'content_length_required' }), {
      status: 411,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const contentLength = Number(rawContentLength);
  if (isNaN(contentLength) || contentLength > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ error: 'payload_too_large' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rawEvents: any[] = Array.isArray(body?.events) ? body.events : [];
  if (rawEvents.length > MAX_BATCH) {
    return new Response(JSON.stringify({ error: 'batch_too_large', max: MAX_BATCH }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const events: LearningEvent[] = [];
  const preRejected: { idempotent_id: string; reason: string }[] = [];

  for (const ev of rawEvents) {
    const err = validateEvent(ev);
    if (err) {
      preRejected.push({ idempotent_id: ev?.idempotent_id ?? 'unknown', reason: err });
    } else {
      events.push(ev as LearningEvent);
    }
  }

  if (events.length === 0 && preRejected.length === 0) return new Response('No events', { status: 400 });
  if (events.length > MAX_BATCH) {
    return new Response(JSON.stringify({ error: 'batch_too_large', max: MAX_BATCH }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const response: SyncResponse = { accepted: [], rejected: [...preRejected], updated_state: [] };
  const now = new Date();

  // 1. Validation
  const validEvents: { ev: LearningEvent; effectiveDate: string; skewMs: number; usedFallback: boolean }[] = [];
  for (const ev of events) {
    if (ev.user_id !== userId) {
      response.rejected.push({ idempotent_id: ev.idempotent_id, reason: 'invalid' });
      continue;
    }
    const ct = new Date(ev.client_timestamp);
    const skewMs = ct.getTime() - now.getTime();
    if (skewMs > CLOCK_SKEW_MAX_MS) {
      response.rejected.push({ idempotent_id: ev.idempotent_id, reason: 'clock_skew_future' });
      continue;
    }
    if (-skewMs > STALE_THRESHOLD_MS) {
      response.rejected.push({ idempotent_id: ev.idempotent_id, reason: 'stale' });
      continue;
    }
    validEvents.push({
      ev,
      effectiveDate: computeEffectiveDate(ev.client_timestamp, now),
      skewMs,
      usedFallback: Math.abs(skewMs) > CLOCK_SKEW_MAX_MS,
    });
  }

  // 2. Group by (user_id, word_id)
  const wordlessEvents = validEvents.filter((v) => !v.ev.word_id);
  const wordEvents = validEvents.filter((v) => v.ev.word_id);
  const groups = new Map<string, typeof wordEvents>();
  for (const v of wordEvents) {
    const key = `${v.ev.user_id}::${v.ev.word_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(v);
  }

  // 3. Wordless events: INSERT + streak update for session_end
  for (const v of wordlessEvents) {
    const { error } = await admin.from('events').insert({
      idempotent_id: v.ev.idempotent_id,
      user_id: v.ev.user_id,
      device_id: v.ev.device_id,
      event_type: v.ev.event_type,
      word_id: null,
      payload: { ...v.ev.payload, skew_ms: v.skewMs, used_fallback: v.usedFallback },
      client_timestamp: v.ev.client_timestamp,
      effective_activity_date_kst: v.effectiveDate,
    });
    if (error?.code === '23505') {
      response.rejected.push({ idempotent_id: v.ev.idempotent_id, reason: 'duplicate' });
    } else if (error) {
      response.rejected.push({ idempotent_id: v.ev.idempotent_id, reason: 'invalid' });
    } else {
      response.accepted.push(v.ev.idempotent_id);
      if (v.ev.event_type === 'session_end') {
        // streak 업데이트 동시성 보호: sentinel UUID로 사용자별 advisory lock
        const STREAK_UUID = '00000000-0000-0000-0000-000000000001';
        const { data: locked, error: streakLockErr } = await admin.rpc('try_advisory_lock', { user_id: userId, word_id: STREAK_UUID });
        if (streakLockErr) {
          console.error(JSON.stringify({ event: 'streak_advisory_lock_failed', userId, error: streakLockErr }));
        } else if (locked) {
          try { await updateStreak(admin, userId, v.effectiveDate); }
          finally { await admin.rpc('release_advisory_lock', { user_id: userId, word_id: STREAK_UUID }); }
        }
      }
    }
  }

  // 4. Word events: LOCK FIRST → INSERT → UPDATE state → UNLOCK
  for (const [key, groupItems] of groups) {
    const [uid, wid] = key.split('::');
    const acquired = await tryAcquireWithRetry(admin, uid, wid, 3, 100);
    if (!acquired) {
      for (const v of groupItems) {
        response.rejected.push({
          idempotent_id: v.ev.idempotent_id,
          reason: 'lock_busy',
          retry_after_seconds: 5,
        });
      }
      continue;
    }

    try {
      const insertedEvents: LearningEvent[] = [];
      for (const v of groupItems) {
        const { error } = await admin.from('events').insert({
          idempotent_id: v.ev.idempotent_id,
          user_id: v.ev.user_id,
          device_id: v.ev.device_id,
          event_type: v.ev.event_type,
          word_id: v.ev.word_id,
          payload: { ...v.ev.payload, skew_ms: v.skewMs, used_fallback: v.usedFallback },
          client_timestamp: v.ev.client_timestamp,
          effective_activity_date_kst: v.effectiveDate,
        });
        if (error?.code === '23505') {
          response.rejected.push({ idempotent_id: v.ev.idempotent_id, reason: 'duplicate' });
        } else if (error) {
          response.rejected.push({ idempotent_id: v.ev.idempotent_id, reason: 'invalid' });
        } else {
          response.accepted.push(v.ev.idempotent_id);
          insertedEvents.push(v.ev);
        }
      }

      if (insertedEvents.length > 0) {
        try {
          const newState = await applyEventsToState(admin, uid, wid, insertedEvents);
          response.updated_state.push(newState);
        } catch (stateErr) {
          console.error(JSON.stringify({ event: 'apply_events_failed', uid, wid, error: String(stateErr) }));
          // Events are accepted (DB insert succeeded); state update failed — client re-fetches on next sync
        }
      }
    } finally {
      await releaseLock(admin, uid, wid);
    }
  }

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
});

async function tryAcquireWithRetry(admin: any, uid: string, wid: string, attempts: number, waitMs: number): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const { data, error } = await admin.rpc('try_advisory_lock', { user_id: uid, word_id: wid });
    if (error) {
      console.error(JSON.stringify({ event: 'try_advisory_lock_failed', uid, wid, attempt: i, error }));
      return false;
    }
    if (data === true) return true;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, waitMs));
  }
  return false;
}

async function releaseLock(admin: any, uid: string, wid: string): Promise<void> {
  const { error } = await admin.rpc('release_advisory_lock', { user_id: uid, word_id: wid });
  if (error) {
    console.error(JSON.stringify({ event: 'release_advisory_lock_failed', uid, wid, error }));
  }
}

async function applyEventsToState(admin: any, uid: string, wid: string, events: LearningEvent[]): Promise<any> {
  events.sort((a, b) => new Date(a.client_timestamp).getTime() - new Date(b.client_timestamp).getTime());
  const last = events[events.length - 1];

  const { data: current, error: currentErr } = await admin
    .from('user_word_state')
    .select('*')
    .eq('user_id', uid)
    .eq('word_id', wid)
    .single();
  if (currentErr && currentErr.code !== 'PGRST116') {
    throw new Error(`user_word_state_select_failed: ${currentErr.code}`);
  }

  const rawQuality = last.payload?.quality ?? 3;
  const quality = (typeof rawQuality === 'number' && rawQuality >= 0 && rawQuality <= 5) ? rawQuality : 3;
  const LADDER = [3600, 86400, 86400 * 3, 86400 * 7, 86400 * 14, 86400 * 30, 86400 * 60];
  const MIN_EASE = 1.3;
  const MAX_INTERVAL_SECONDS = 86400 * 365; // 365일 상한

  let newIntervalSec: number;
  let newEase: number;

  if (quality < 3) {
    newIntervalSec = 3600;
    newEase = Math.max(MIN_EASE, (current?.ease_factor ?? 2.5) - 0.2);
  } else if (quality === 3) {
    const curInterval = current?.interval_seconds ?? 3600;
    const idx = LADDER.findIndex((s) => s > curInterval);
    newIntervalSec = idx === -1
      ? Math.min(Math.round(curInterval * (current?.ease_factor ?? 2.5)), MAX_INTERVAL_SECONDS)
      : LADDER[idx];
    newEase = Math.max(MIN_EASE, (current?.ease_factor ?? 2.5) - 0.05);
  } else {
    const curInterval = current?.interval_seconds ?? 3600;
    const idx = LADDER.findIndex((s) => s > curInterval);
    newIntervalSec = idx === -1
      ? Math.min(Math.round(curInterval * (current?.ease_factor ?? 2.5)), MAX_INTERVAL_SECONDS)
      : LADDER[idx];
    newEase = Math.max(MIN_EASE, (current?.ease_factor ?? 2.5) + 0.1 * (quality - 4));
  }

  const newState = {
    user_id: uid,
    word_id: wid,
    last_review_at: new Date().toISOString(),
    next_due_at: new Date(Date.now() + newIntervalSec * 1000).toISOString(),
    interval_seconds: newIntervalSec,
    ease_factor: Math.max(1.3, newEase),
    lapse_count: (current?.lapse_count ?? 0) + (quality < 3 ? 1 : 0),
  };

  const { error: upsertErr } = await admin.from('user_word_state').upsert(newState);
  if (upsertErr) {
    console.error(JSON.stringify({ event: 'user_word_state_upsert_failed', user_id: uid, word_id: wid, error: upsertErr }));
    throw new Error('user_word_state_upsert_failed');
  }
  return newState;
}
