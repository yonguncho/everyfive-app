/**
 * EveryFive Service Worker
 * Architecture v4 Section 7.1 + Codex QA D Round 1 반영
 *
 * 캐시 전략:
 *  - StaleWhileRevalidate: 콘텐츠 JSON (versioned URL)
 *  - CacheFirst: 정적 자산 (JS/CSS/이미지)
 *  - NetworkFirst with cache fallback: API GET
 *  - Offline fallback: /offline.html
 */

const APP_VERSION = '0.1.0';
const STATIC_CACHE = `static-${APP_VERSION}`;
const API_CACHE = `api-${APP_VERSION}`;  // version 포함 → 옛 cache 자동 정리
const CONTENT_CACHE = `content-${APP_VERSION}`;
const STATIC_ASSETS = ['/', '/manifest.json', '/offline.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // 모든 옛 버전 cache 정리 (APP_VERSION 매칭 안 되는 모든 것)
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) =>
          (k.startsWith('static-') && k !== STATIC_CACHE) ||
          (k.startsWith('api-') && k !== API_CACHE) ||
          (k.startsWith('content-') && k !== CONTENT_CACHE)
        ).map((k) => caches.delete(k)))
      ),
      self.clients.claim(),
    ])
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. 콘텐츠 JSON (versioned URL): StaleWhileRevalidate (event.waitUntil로 revalidate 보장)
  if (url.pathname.startsWith('/content/')) {
    event.respondWith(staleWhileRevalidate(event, CONTENT_CACHE));
    return;
  }

  // 2. API 호출 (Supabase / Next.js API): NetworkFirst + 성공 시 cache (GET만)
  if (url.pathname.startsWith('/api/') || url.hostname.includes('supabase.co')) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  // 3. Next.js _next 정적 청크: CacheFirst
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // 4. 기본: NetworkFirst with offline fallback
  event.respondWith(networkFirstWithFallback(request));
});

async function staleWhileRevalidate(event, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);

  const revalidate = fetch(event.request).then((resp) => {
    if (resp.ok) cache.put(event.request, resp.clone());
    return resp;
  }).catch(() => cached);

  // event.waitUntil로 revalidate 보장 (SW 종료 전에 cache.put 완료)
  event.waitUntil(revalidate);

  return cached || revalidate;
}

async function networkFirstApi(request) {
  // Authorization 또는 Cookie 포함 요청 = 사용자별 데이터 → 절대 캐시하지 않음
  const hasAuth = request.headers.has('Authorization') || request.headers.has('Cookie');
  // supabase.co 요청 = 항상 사용자별 → 캐시하지 않음
  const isSupabase = request.url.includes('supabase.co');

  try {
    const resp = await fetch(request);
    if (resp.ok && request.method === 'GET' && !hasAuth && !isSupabase) {
      // JSON 응답만 캐시 (allowlist: 인증 없는 공개 API 응답)
      const ct = resp.headers.get('Content-Type') ?? '';
      if (ct.includes('application/json')) {
        const cache = await caches.open(API_CACHE);
        cache.put(request, resp.clone());
      }
    }
    return resp;
  } catch {
    // 캐시 폴백은 인증 없는 요청에만 허용
    if (!hasAuth && !isSupabase) {
      const cached = await caches.match(request);
      if (cached) return cached;
    }
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const resp = await fetch(request);
  if (resp.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, resp.clone());
  }
  return resp;
}

async function networkFirstWithFallback(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      return (await caches.match('/offline.html')) || new Response('Offline', { status: 503 });
    }
    return new Response('Offline', { status: 503 });
  }
}

// 클라이언트 메시지
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_CACHES') {
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
  }
});
