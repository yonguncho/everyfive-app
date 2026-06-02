import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const WORD_RE = /^[a-zA-Z0-9 '\-]+$/;
const TTL_DAYS = 7;
const RATE_LIMIT = 5;          // Unsplash 호출 건수 / IP / 분
const RATE_WINDOW_MS = 60_000;

function createAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// 인메모리 rate-limit 버킷 (서버리스 재시작 시 초기화 — 캐시 계층이 1차 방어)
// NOTE: 인스턴스별 독립 상태 — 글로벌 rate limit 목적이 아닌 Unsplash 호출 과부하 방지용
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
let lastBucketPrune = 0;
const PRUNE_INTERVAL_MS = 5 * 60_000; // 5분마다 만료 항목 제거 (Map 무한 증가 방지)

function maybePruneRateBuckets(now: number): void {
  if (now - lastBucketPrune < PRUNE_INTERVAL_MS) return;
  lastBucketPrune = now;
  for (const [ip, bucket] of rateBuckets) {
    if (now > bucket.resetAt) rateBuckets.delete(ip);
  }
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  maybePruneRateBuckets(now);
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT) return false;
  bucket.count++;
  return true;
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function GET(req: NextRequest) {
  const word = req.nextUrl.searchParams.get('word');

  if (!word || word.length > 50 || !WORD_RE.test(word)) {
    return NextResponse.json({ error: 'invalid_word' }, { status: 400 });
  }

  const admin = createAdmin();
  const ttlDate = new Date(Date.now() - TTL_DAYS * 86400 * 1000).toISOString();

  // 캐시 히트 확인 (rate limit 전 — 캐시 히트는 Unsplash 호출 없음)
  const { data: cached, error: cacheErr } = await admin
    .from('word_images')
    .select('image_url, photographer')
    .eq('word', word)
    .gte('cached_at', ttlDate)
    .maybeSingle();

  if (cacheErr) {
    console.error(JSON.stringify({ event: 'word_image_cache_read_failed', word, error: cacheErr.message }));
  }

  if (cached) {
    console.log(JSON.stringify({ event: 'word_image_cache_hit', word }));
    return NextResponse.json({ image_url: cached.image_url, photographer: cached.photographer ?? null });
  }

  // 캐시 미스 → Unsplash 호출 전 rate limit 체크
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    console.warn(JSON.stringify({ event: 'word_image_rate_limited', ip, word }));
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const unsplashKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!unsplashKey) {
    console.error(JSON.stringify({ event: 'word_image_no_unsplash_key', word }));
    return NextResponse.json({ image_url: null });
  }

  try {
    const startMs = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    let res: Response;
    try {
      res = await fetch(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(word)}&per_page=1&client_id=${unsplashKey}`,
        { signal: controller.signal },
      );
    } finally {
      clearTimeout(timeoutId);
    }
    const durationMs = Date.now() - startMs;

    if (!res.ok) {
      console.error(JSON.stringify({ event: 'unsplash_api_error', word, status: res.status, durationMs }));
      return NextResponse.json({ image_url: null });
    }

    const data = await res.json();
    const photo = data?.results?.[0];

    console.log(JSON.stringify({ event: 'unsplash_api_called', word, found: !!photo, durationMs }));

    if (!photo) {
      return NextResponse.json({ image_url: null });
    }

    const imageUrl: string = photo.urls?.small ?? photo.urls?.regular;
    const photographer: string | null = photo.user?.name ?? null;

    // UPSERT (word UNIQUE → ON CONFLICT UPDATE)
    const { error: upsertErr } = await admin
      .from('word_images')
      .upsert(
        { word, image_url: imageUrl, photographer, cached_at: new Date().toISOString() },
        { onConflict: 'word' },
      );

    if (upsertErr) {
      console.error(JSON.stringify({ event: 'word_image_upsert_failed', word, error: upsertErr.message }));
    }

    return NextResponse.json({ image_url: imageUrl, photographer });
  } catch (e) {
    console.error(JSON.stringify({ event: 'word_image_fetch_error', word, error: (e as Error)?.message }));
    return NextResponse.json({ image_url: null });
  }
}
