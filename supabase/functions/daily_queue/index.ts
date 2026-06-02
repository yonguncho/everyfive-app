/**
 * daily_queue Edge Function — everyfive-app v1.3
 *
 * 처리 흐름:
 *  1. OPTIONS preflight → CORS 헤더 반환
 *  2. Content-Length guard: absent → 411, > 2048 → 413
 *  3. JWT에서 user_id 추출 (sync-events 패턴 재사용)
 *  4. req.json() → { target_date? }
 *  5. target_date 검증 (YYYY-MM-DD 형식 아님 → 400)
 *  6. daily_queue 캐시 SELECT → 히트 시 즉시 200 반환
 *  7. user_word_state에서 SM-2 due 단어 SELECT (최대 5개)
 *  8. 부족 시 미학습 단어 보충 → SAMPLE_WORD_IDS fallback
 *  9. FNV-32a seed + Fisher-Yates 셔플
 * 10. daily_queue UPSERT
 * 11. 200 { word_ids, session_seed, generated_at }
 * catch: console.error + 500 { error: 'internal_error' }
 */

// @ts-ignore Deno imports
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
// @ts-ignore Deno imports
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// @ts-ignore Deno globals
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
// @ts-ignore Deno globals
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// @ts-ignore Deno globals
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
// @ts-ignore Deno globals
const ALLOWED_ORIGIN = Deno.env.get('NEXT_PUBLIC_APP_URL') ?? '';

const MAX_BODY_BYTES = 2048;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const QUEUE_SIZE_MAP: Record<string, number> = { pro_10: 10, pro_15: 15, pro_20: 20, pro_30: 30 };
const DEFAULT_QUEUE_SIZE = 5;

/** KST(UTC+9) 기준 YYYY-MM-DD 반환 — DB cron generate_daily_queue_for_user와 일치 */
function getKSTDateString(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// fallback UUID 풀 (CDN words 없을 때 사용)
const SAMPLE_WORD_IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000005',
];

function getCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Vary': 'Origin',
  };
  if (origin && ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
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
  } catch {
    return null;
  }
}

/** FNV-32a 비암호화 해시 (셔플 seed 목적으로 충분) */
function fnv32a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function computeSeed(userId: string, date: string): number {
  // | 0 → signed int32 (-2,147,483,648 ~ 2,147,483,647) → PostgreSQL INTEGER 범위 내
  return (fnv32a(userId) ^ fnv32a(date)) | 0;
}

/** mulberry32: 빠른 32-bit seeded PRNG */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fisherYates<T>(arr: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    // 2. Content-Length guard: absent → 411, 초과 → 413 (HTTP 표준 준수)
    const rawContentLength = req.headers.get('content-length');
    if (!rawContentLength) {
      return new Response(
        JSON.stringify({ error: 'content_length_required' }),
        { status: 411, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }
    if (isNaN(Number(rawContentLength)) || Number(rawContentLength) > MAX_BODY_BYTES) {
      return new Response(
        JSON.stringify({ error: 'payload_too_large' }),
        { status: 413, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    // 3. JWT 검증 → user_id 추출
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }
    const userId = await verifyJwtAndGetUserId(authHeader);
    if (!userId) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }

    // 4. body 파싱
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // body 없거나 빈 경우 허용 (target_date 생략 가능)
    }

    // 5. target_date 검증
    let targetDate: string;
    if (body?.target_date !== undefined) {
      if (typeof body.target_date !== 'string' || !DATE_RE.test(body.target_date)) {
        return new Response(
          JSON.stringify({ error: 'invalid_date_format' }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }
      // 형식 체크 통과 후 실제 날짜 유효성 검증 (2026-99-99, 2026-02-30 방지)
      const parsedDate = new Date(body.target_date + 'T00:00:00Z');
      if (isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== body.target_date) {
        return new Response(
          JSON.stringify({ error: 'invalid_date_format' }),
          { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }
      targetDate = body.target_date;
    } else {
      targetDate = getKSTDateString();
    }

    // 미래 날짜 차단 (투기적 큐 생성 방지) + 30일 이전 차단 (TTL 범위 벗어남)
    const today = getKSTDateString();
    if (targetDate > today) {
      return new Response(
        JSON.stringify({ error: 'future_date_not_allowed' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }
    // KST(UTC+9) 기준으로 30일 전 날짜 계산 (UTC 기준 사용 시 KST 00:00~08:59 에 1일 오차)
    const thirtyDaysAgo = new Date(Date.now() + 9 * 60 * 60 * 1000 - 30 * 86400 * 1000).toISOString().slice(0, 10);
    if (targetDate < thirtyDaysAgo) {
      return new Response(
        JSON.stringify({ error: 'date_too_old' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // 5-b. subscriptions 조회 → per-plan queueSize 결정
    const { data: sub } = await admin
      .from('subscriptions')
      .select('plan, status')
      .eq('user_id', userId)
      .maybeSingle();

    const activeStatuses = ['ACTIVE', 'TRIAL', 'CANCELED_AT_PERIOD_END', 'PAST_DUE'];
    const queueSize = (sub && activeStatuses.includes(sub?.status ?? ''))
      ? (QUEUE_SIZE_MAP[sub?.plan ?? ''] ?? DEFAULT_QUEUE_SIZE)
      : DEFAULT_QUEUE_SIZE;

    console.log(JSON.stringify({ event: 'queue_size_resolved', userId, queueSize, plan: sub?.plan ?? 'free' }));

    // 6. 캐시 SELECT
    const { data: cached, error: cacheErr } = await admin
      .from('daily_queue')
      .select('word_ids, session_seed, generated_at')
      .eq('user_id', userId)
      .eq('date', targetDate)
      .single();

    if (cacheErr && cacheErr.code !== 'PGRST116') {
      console.error(JSON.stringify({ event: 'daily_queue_cache_select_failed', userId, error: cacheErr }));
      return new Response(
        JSON.stringify({ error: 'internal_error' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    const isPlaceholder = cached && (
      !Array.isArray(cached.word_ids) ||
      cached.word_ids.length === 0 ||
      cached.session_seed === 0
    );
    // 플랜 변경으로 큐 크기가 달라진 경우 캐시 miss로 취급해 재생성
    const isSizeMismatch = cached && Array.isArray(cached.word_ids) && cached.word_ids.length !== queueSize;
    if (cached && !isPlaceholder && !isSizeMismatch) {
      // 캐시 히트 → 즉시 반환
      return new Response(
        JSON.stringify({
          word_ids: cached.word_ids,
          session_seed: cached.session_seed,
          generated_at: cached.generated_at,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    // 7. SM-2 due_date SELECT
    const { data: dueStates, error: dueErr } = await admin
      .from('user_word_state')
      .select('word_id')
      .eq('user_id', userId)
      .lte('next_due_at', `${targetDate}T23:59:59.999Z`)
      .order('next_due_at', { ascending: true })
      .limit(queueSize);

    if (dueErr) {
      console.error(JSON.stringify({ event: 'due_state_select_failed', userId, error: dueErr }));
      return new Response(
        JSON.stringify({ error: 'internal_error' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    const dueIds: string[] = (dueStates ?? []).map((s: any) => s.word_id as string);

    // 9-pre. seed 먼저 계산 — 보충 블록(step 8)과 최종 셔플(step 9) 양쪽에서 사용
    const seed = computeSeed(userId, targetDate);

    // 8. 부족 시 보충 — words 테이블에서 미학습 신규 단어 선택
    //    미학습 = user_word_state에 아예 없는 단어 (due가 아닌 학습 중 단어도 제외)
    let wordIds: string[] = [...dueIds];

    if (wordIds.length < queueSize) {
      // user_word_state에 이미 등록된 단어(학습 중 포함) 조회 → 보충 대상에서 제외
      const { data: allStates } = await admin
        .from('user_word_state')
        .select('word_id')
        .eq('user_id', userId);

      const learnedIds = (allStates ?? []).map((s: any) => s.word_id as string);
      const allExcludeIds = [...new Set([...dueIds, ...learnedIds])];

      const needed = queueSize - wordIds.length;
      const excludeClause = allExcludeIds.length > 0
        ? `(${allExcludeIds.map((id) => `'${id}'`).join(',')})`
        : "('00000000-0000-0000-0000-000000000000')";

      // 후보 풀을 넉넉하게 가져온 뒤 seed shuffle로 매일 다른 단어 선택
      // needed만 가져오면 항상 같은 첫 N개(UUID 오름차순)가 반복됨
      const candidateLimit = Math.min(needed * 40, 300);
      const { data: newWords, error: newWordsErr } = await admin
        .from('words')
        .select('word_id')
        .not('word_id', 'in', excludeClause)
        .order('word_id')
        .limit(candidateLimit);

      if (newWordsErr) {
        console.error(JSON.stringify({ event: 'words_select_failed', userId, error: newWordsErr.message }));
      } else {
        const candidateIds = (newWords ?? []).map((w: any) => w.word_id as string);
        // XOR로 seed 변형 → 후보 풀 셔플과 최종 셔플이 독립적으로 동작
        const shuffledCandidates = fisherYates(candidateIds, seed ^ 0x5a5a5a5a);
        const supplementIds = shuffledCandidates.slice(0, needed);
        wordIds = [...wordIds, ...supplementIds];
        console.log(JSON.stringify({ event: 'words_supplement', userId, candidates: candidateIds.length, added: supplementIds.length, totalAfter: wordIds.length }));
      }
    }

    // SAMPLE_WORD_IDS fallback: words 테이블이 비어 있거나 모두 학습 완료된 경우
    if (wordIds.length < queueSize) {
      const usedIds = new Set(wordIds);
      for (const sampleId of SAMPLE_WORD_IDS) {
        if (wordIds.length >= queueSize) break;
        if (!usedIds.has(sampleId)) wordIds.push(sampleId);
      }
      console.log(JSON.stringify({ event: 'sample_fallback', userId, total: wordIds.length }));
    }

    wordIds = wordIds.slice(0, queueSize);

    // 9. Fisher-Yates 셔플 (seed는 step 8 이전에 선언됨)
    const shuffled = fisherYates(wordIds, seed);

    // 10. daily_queue UPSERT
    const generatedAt = new Date().toISOString();
    const { error: upsertErr } = await admin.from('daily_queue').upsert({
      user_id: userId,
      date: targetDate,
      word_ids: shuffled,
      session_seed: seed,
      generated_at: generatedAt,
    }, { onConflict: 'user_id,date' });

    if (upsertErr) {
      console.error(JSON.stringify({ event: 'daily_queue_upsert_failed', userId, error: upsertErr }));
      return new Response(
        JSON.stringify({ error: 'internal_error' }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    // 11. 200 반환
    return new Response(
      JSON.stringify({
        word_ids: shuffled,
        session_seed: seed,
        generated_at: generatedAt,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );

  } catch (e) {
    console.error(JSON.stringify({ event: 'daily_queue_unhandled_error', userId: 'unknown', error: (e as Error)?.message ?? 'unknown' }));
    return new Response(
      JSON.stringify({ error: 'internal_error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
