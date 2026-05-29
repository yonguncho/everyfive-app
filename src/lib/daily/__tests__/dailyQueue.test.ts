import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fetchDailyQueue, resolveWordsByIds, SAMPLE_WORDS, fnv32a, computeSeed, fisherYates, buildBlankSentence, getDifficultyFilter } from '../dailyQueue';

const makeSupabase = (token: string | null) => ({
  auth: {
    getSession: vi.fn().mockResolvedValue({
      data: { session: token ? { access_token: token } : null },
    }),
  },
});

const makeSupabaseDb = (rows: any[] | null, error: any = null) => ({
  from: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({ data: rows, error }),
    }),
  }),
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('순수 함수: fnv32a / computeSeed / fisherYates', () => {
  it('fnv32a("hello") → 고정 해시값 (Edge Function과 동일)', () => {
    expect(fnv32a('hello')).toBe(0x4f9f2cab);
  });

  it('computeSeed — 동일 입력 → 동일 출력 (결정론적)', () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const date = '2026-05-28';
    expect(computeSeed(userId, date)).toBe(computeSeed(userId, date));
  });

  it('computeSeed — 다른 날짜 → 다른 seed', () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    expect(computeSeed(userId, '2026-05-28')).not.toBe(computeSeed(userId, '2026-05-29'));
  });

  it('fisherYates — 같은 seed로 동일 배열 → 재현 가능한 순열', () => {
    const arr = [1, 2, 3, 4, 5];
    const seed = 42;
    const shuffle1 = fisherYates(arr, seed);
    const shuffle2 = fisherYates(arr, seed);
    expect(shuffle1).toEqual(shuffle2);
    expect([...shuffle1].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('buildBlankSentence', () => {
  it('예문에 단어가 있으면 _____로 치환', () => {
    const result = buildBlankSentence('bag', 'Put your books in the bag.');
    expect(result).toBe('Put your books in the _____.');
    expect(result).not.toBe('_____');
  });

  it('대소문자 구분 없이 치환', () => {
    const result = buildBlankSentence('apple', 'She ate an Apple every day.');
    expect(result).toBe('She ate an _____ every day.');
  });

  it('단어가 예문에 없으면 힌트 포맷 반환', () => {
    const result = buildBlankSentence('bag', 'She carried a heavy load.');
    expect(result).toContain('_____');
  });

  it('예문이 없으면 기본 빈칸 반환', () => {
    const result = buildBlankSentence('bag', null);
    expect(result).toContain('_____');
  });

  it('resolveWordsByIds가 반환하는 quiz.blank_sentence에 문장이 포함됨 (___만 아님)', async () => {
    const rows = [
      { word_id: 'id-1', word: 'bag', definition_ko: '가방', definition_en: 'bag', example_sentence: 'Put your books in the bag.', difficulty: 1, category: 'noun' },
    ];
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({ data: rows, error: null }),
        }),
      }),
    };
    const result = await resolveWordsByIds(['id-1'], mockSupabase);
    expect(result[0].quiz.blank_sentence).toBe('Put your books in the _____.');
    expect(result[0].quiz.blank_sentence).not.toBe('_____');
  });
});

describe('fetchDailyQueue', () => {
  it('200 응답 시 word_ids + session_seed 반환', async () => {
    const payload = {
      word_ids: ['id-1', 'id-2', 'id-3'],
      session_seed: 98765,
      generated_at: '2026-05-28T00:00:00Z',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    }));

    const result = await fetchDailyQueue(makeSupabase('tok'));
    expect(result).toEqual({ wordIds: ['id-1', 'id-2', 'id-3'], sessionSeed: 98765 });
  });

  it('AbortError (8초 timeout) → null 반환', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      new DOMException('The operation was aborted.', 'AbortError'),
    ));
    const result = await fetchDailyQueue(makeSupabase('tok'));
    expect(result).toBeNull();
  });

  it('5xx 응답 → null 반환', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const result = await fetchDailyQueue(makeSupabase('tok'));
    expect(result).toBeNull();
  });
});

describe('getDifficultyFilter — BUG-01: 레벨별 difficulty 배열', () => {
  it('A1 → [1, 2]', () => {
    expect(getDifficultyFilter('A1')).toEqual([1, 2]);
  });

  it('B1 → [2, 3]', () => {
    expect(getDifficultyFilter('B1')).toEqual([2, 3]);
  });

  it('C1 → [3, 4, 5]', () => {
    expect(getDifficultyFilter('C1')).toEqual([3, 4, 5]);
  });

  it('알 수 없는 레벨 → [3, 4, 5] 기본값', () => {
    expect(getDifficultyFilter('unknown')).toEqual([3, 4, 5]);
  });
});

describe('fisherYates — BUG-05: SAMPLE_WORDS fallback seed 보장', () => {
  it('seed가 다르면 배열 순서도 다름 (매일 다른 단어 노출)', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const s1 = fisherYates(arr, 1001);
    const s2 = fisherYates(arr, 9999);
    expect(s1).not.toEqual(s2);
  });

  it('같은 seed → SAMPLE_WORDS 순서도 동일 (결정론적 fallback)', () => {
    const seed = 12345;
    const copy = SAMPLE_WORDS.map((w) => w.word_id);
    const r1 = fisherYates([...copy], seed);
    const r2 = fisherYates([...copy], seed);
    expect(r1).toEqual(r2);
  });
});

describe('resolveWordsByIds', () => {
  it('Supabase 정상 조회 → Word[] 반환 + 순서 보존', async () => {
    const rows = [
      { word_id: 'id-1', word: 'test', definition_ko: '테스트', definition_en: 'test', example_sentence: 'This is a test.', difficulty: 1, category: 'daily' },
      { word_id: 'id-2', word: 'hello', definition_ko: '안녕', definition_en: 'hello', example_sentence: 'Hello!', difficulty: 1, category: 'daily' },
      { word_id: 'id-3', word: 'world', definition_ko: '세상', definition_en: 'world', example_sentence: 'Hello world.', difficulty: 2, category: 'daily' },
    ];
    const mockSupabase = makeSupabaseDb(rows);

    // 순서 역전해서 조회
    const result = await resolveWordsByIds(['id-3', 'id-1', 'id-2'], mockSupabase);
    expect(result.map((w) => w.word_id)).toEqual(['id-3', 'id-1', 'id-2']);
    expect(result[0].word).toBe('world');
  });

  it('Supabase 에러 → SAMPLE_WORDS fallback', async () => {
    const mockSupabase = makeSupabaseDb(null, { message: 'DB error' });
    const result = await resolveWordsByIds(['id-1', 'id-2'], mockSupabase);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].word_id).toBe(SAMPLE_WORDS[0].word_id);
  });

  it('wordIds=[] → [] 반환', async () => {
    const mockSupabase = makeSupabaseDb([]);
    const result = await resolveWordsByIds([], mockSupabase);
    expect(result).toEqual([]);
  });
});
