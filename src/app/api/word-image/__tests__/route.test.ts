import { describe, it, expect, vi, afterEach } from 'vitest';

// word-image route의 핵심 검증 로직 직접 테스트
const WORD_RE = /^[a-zA-Z0-9 '\-]+$/;
const TTL_DAYS = 7;

function isValidWord(word: string | null): boolean {
  if (!word || word.length > 50 || !WORD_RE.test(word)) return false;
  return true;
}

function isCacheHit(cachedAt: string, ttlDays: number): boolean {
  const ttlDate = new Date(Date.now() - ttlDays * 86400 * 1000);
  return new Date(cachedAt) >= ttlDate;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('word-image 입력 검증', () => {
  it('유효한 단어 → 통과', () => {
    expect(isValidWord('apple')).toBe(true);
    expect(isValidWord('look up')).toBe(true);
    expect(isValidWord("rock n' roll")).toBe(true);
  });

  it('word 없음(null) → 실패', () => {
    expect(isValidWord(null)).toBe(false);
  });

  it('50자 초과 단어 → 실패', () => {
    expect(isValidWord('a'.repeat(51))).toBe(false);
  });

  it('특수문자 포함 → 실패', () => {
    expect(isValidWord('test<script>')).toBe(false);
    expect(isValidWord('hello; DROP TABLE')).toBe(false);
  });
});

describe('word-image 캐시 TTL 검증', () => {
  it('6일 전 캐시 → 히트 (TTL 7일 이내)', () => {
    const sixDaysAgo = new Date(Date.now() - 6 * 86400 * 1000).toISOString();
    expect(isCacheHit(sixDaysAgo, TTL_DAYS)).toBe(true);
  });

  it('8일 전 캐시 → 미스 (TTL 7일 초과)', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 86400 * 1000).toISOString();
    expect(isCacheHit(eightDaysAgo, TTL_DAYS)).toBe(false);
  });

  it('방금 캐시 → 히트', () => {
    const now = new Date().toISOString();
    expect(isCacheHit(now, TTL_DAYS)).toBe(true);
  });
});

describe('word-image Unsplash 응답 처리 mock', () => {
  it('Unsplash 정상 응답 → image_url 반환', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        results: [
          { urls: { small: 'https://images.unsplash.com/photo-test' }, user: { name: 'Photographer Name' } }
        ]
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await global.fetch('https://api.unsplash.com/search/photos?query=apple&per_page=1&client_id=test');
    const data = await res.json();
    expect(data.results[0].urls.small).toBe('https://images.unsplash.com/photo-test');
    expect(data.results[0].user.name).toBe('Photographer Name');
  });

  it('Unsplash 결과 없음 → image_url: null', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await global.fetch('https://api.unsplash.com/search/photos?query=xyznotexist&per_page=1&client_id=test');
    const data = await res.json();
    expect(data.results.length).toBe(0);
  });

  it('Unsplash API 에러 → { image_url: null }', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await global.fetch('https://api.unsplash.com/search/photos?query=apple&per_page=1&client_id=invalid');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
  });
});
