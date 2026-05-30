import type { Word } from '@/components/learning/WordCard';

/**
 * example_sentence에서 단어를 _____로 치환해 빈칸 문제 생성.
 * 단어가 문장에 없으면 단어 자체를 답으로 하는 단순 빈칸 반환.
 */
export function buildBlankSentence(word: string, exampleSentence?: string | null, definitionKo?: string | null): string {
  const hint = definitionKo ? `"${definitionKo}"` : '이 단어';
  if (!exampleSentence) return `${hint}를 영어로 쓰면? _____`;

  // _N suffix 제거 (add_words_v2.py 생성 단어: "acquisition_10" → "acquisition")
  const baseWord = word.replace(/_\d+$/, '');

  function tryReplace(target: string): string | null {
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    if (re.test(exampleSentence!)) {
      return exampleSentence!.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '_____');
    }
    return null;
  }

  return tryReplace(baseWord) ?? tryReplace(word) ?? `${hint}를 영어로 쓰면? _____`;
}

/** FNV-32a non-cryptographic hash (Edge Function과 동일 구현, seed 생성용) */
export function fnv32a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** mulberry32: 빠른 32-bit seeded PRNG */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Edge Function と同じ seed 計算 (userId × date → deterministic uint32) */
export function computeSeed(userId: string, date: string): number {
  return (fnv32a(userId) ^ fnv32a(date)) >>> 0;
}

/** Fisher-Yates shuffle — deterministic by seed */
export function fisherYates<T>(arr: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export const SAMPLE_WORDS: Word[] = [
  {
    word_id: '00000000-0000-4000-8000-000000000001',
    word: 'look up',
    meaning_ko: '찾아보다 / 존경하다 (to someone)',
    ipa: '/lʊk ʌp/',
    pronunciation_ko: '룩 업',
    phrasal_verbs: [{ phrase: 'look up to', meaning_ko: '~을 존경하다' }],
    scenarios: [
      { context: '회의', example_en: 'Let me look up the data first.', example_ko: '먼저 데이터를 찾아볼게요.' },
      { context: '식사', example_en: 'I really look up to my mentor.', example_ko: '저는 멘토를 정말 존경해요.' },
      { context: '이메일', example_en: 'Could you look up the latest version?', example_ko: '최신 버전 좀 찾아봐 주실래요?' },
    ],
    quiz: { blank_sentence: 'I _____ to my older brother.', answer: 'look up' },
  },
  {
    word_id: '00000000-0000-4000-8000-000000000002',
    word: 'figure out',
    meaning_ko: '알아내다 / 이해하다',
    ipa: '/ˈfɪɡjər aʊt/',
    pronunciation_ko: '피겨 아웃',
    phrasal_verbs: [{ phrase: 'figure something out', meaning_ko: '~을 알아내다' }],
    scenarios: [
      { context: '회의', example_en: 'Let me figure out what went wrong.', example_ko: '뭐가 잘못됐는지 알아볼게요.' },
      { context: '식사', example_en: "I can't figure out this menu.", example_ko: '이 메뉴 이해 못 하겠어요.' },
      { context: '이메일', example_en: 'Could you figure out the issue?', example_ko: '이슈 좀 파악해 주실래요?' },
    ],
    quiz: { blank_sentence: 'I need to ____ this problem.', answer: 'figure out' },
  },
  {
    word_id: '00000000-0000-4000-8000-000000000003',
    word: 'follow up',
    meaning_ko: '후속 조치하다 / 다시 연락하다',
    ipa: '/ˈfɒloʊ ʌp/',
    pronunciation_ko: '팔로우 업',
    phrasal_verbs: [{ phrase: 'follow up on', meaning_ko: '~에 대해 후속 처리하다' }],
    scenarios: [
      { context: '회의', example_en: "I'll follow up on this next week.", example_ko: '다음 주에 후속 처리할게요.' },
      { context: '식사', example_en: 'Let me follow up with you tomorrow.', example_ko: '내일 다시 연락드릴게요.' },
      { context: '이메일', example_en: 'Following up on my previous email.', example_ko: '이전 이메일 관련 후속입니다.' },
    ],
    quiz: { blank_sentence: 'I will ____ on this issue.', answer: 'follow up' },
  },
  {
    word_id: '00000000-0000-4000-8000-000000000004',
    word: 'come up with',
    meaning_ko: '생각해내다 / 떠올리다',
    ipa: '/kʌm ʌp wɪð/',
    pronunciation_ko: '컴 업 위드',
    phrasal_verbs: [{ phrase: 'come up with an idea', meaning_ko: '아이디어를 떠올리다' }],
    scenarios: [
      { context: '회의', example_en: 'We need to come up with a plan.', example_ko: '계획을 세워야 해요.' },
      { context: '식사', example_en: 'How did you come up with this recipe?', example_ko: '이 레시피 어떻게 떠올렸어요?' },
      { context: '이메일', example_en: 'Can you come up with three options?', example_ko: '세 가지 옵션 떠올려 주실래요?' },
    ],
    quiz: { blank_sentence: 'We need to _____ a solution.', answer: 'come up with' },
  },
  {
    word_id: '00000000-0000-4000-8000-000000000005',
    word: 'reach out',
    meaning_ko: '연락하다 / 손을 내밀다',
    ipa: '/riːtʃ aʊt/',
    pronunciation_ko: '리치 아웃',
    phrasal_verbs: [{ phrase: 'reach out to', meaning_ko: '~에게 연락하다' }],
    scenarios: [
      { context: '회의', example_en: "I'll reach out to the team.", example_ko: '팀에 연락할게요.' },
      { context: '식사', example_en: 'Feel free to reach out anytime.', example_ko: '언제든 편하게 연락 주세요.' },
      { context: '이메일', example_en: 'Reaching out about the project.', example_ko: '프로젝트 관련해서 연락드립니다.' },
    ],
    quiz: { blank_sentence: 'Please ____ if you have questions.', answer: 'reach out' },
  },
];

/** level 문자열로부터 difficulty 필터 배열 반환 */
export function getDifficultyFilter(level: string): number[] {
  if (level === 'A1') return [1, 2];
  if (level === 'B1') return [2, 3];
  return [3, 4, 5];
}

interface DailyQueueResponse {
  word_ids: string[];
  session_seed: number;
  generated_at: string;
}

type SupabaseAuthAdapter = {
  auth: {
    getSession: () => Promise<{ data: { session: { access_token: string } | null } }>;
  };
};

export async function fetchDailyQueue(
  supabase: SupabaseAuthAdapter,
  targetDate?: string,
): Promise<{ wordIds: string[]; sessionSeed: number } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const bodyObj = targetDate ? { target_date: targetDate } : {};
    const bodyStr = JSON.stringify(bodyObj);

    const res = await fetch(`${supabaseUrl}/functions/v1/daily_queue`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: bodyStr,
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data: DailyQueueResponse = await res.json();
    return { wordIds: data.word_ids, sessionSeed: data.session_seed };
  } catch (e) {
    console.warn(JSON.stringify({ event: 'daily_queue_fetch_failed', error: (e as Error)?.message }));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveWordsByIds(
  wordIds: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (...args: any[]) => any },
): Promise<Word[]> {
  if (wordIds.length === 0) return [];

  try {
    const { data: rows, error } = await supabase
      .from('words')
      .select('word_id, word, definition_ko, definition_en, example_sentence, example_sentence_ko, difficulty, category, ipa, pronunciation_ko')
      .in('word_id', wordIds);

    if (error) throw error;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rowMap = new Map<string, any>((rows ?? []).map((r: any) => [r.word_id, r]));

    // wordIds 순서 보존
    const resolved = wordIds
      .map((id) => rowMap.get(id))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((r): r is any => !!r)
      .map((r): Word => ({
        word_id: r.word_id,
        word: r.word,
        definition_ko: r.definition_ko,
        definition_en: r.definition_en ?? undefined,
        example_sentence: r.example_sentence ?? undefined,
        difficulty: r.difficulty,
        category: r.category,
        // WordCard 호환: DB에 없는 필드는 빈값으로 채움
        meaning_ko: r.definition_ko,
        ipa: r.ipa ?? '',
        pronunciation_ko: r.pronunciation_ko ?? undefined,
        phrasal_verbs: [],
        scenarios: r.example_sentence
          ? [{ context: 'example', example_en: r.example_sentence, example_ko: r.example_sentence_ko ?? '' }]
          : [],
        quiz: { blank_sentence: buildBlankSentence(r.word, r.example_sentence, r.definition_ko), answer: r.word },
      }));

    if (resolved.length === 0) return SAMPLE_WORDS.slice(0, wordIds.length || 5);
    return resolved;
  } catch (e) {
    console.warn(JSON.stringify({ event: 'resolve_words_failed', error: (e as Error)?.message }));
    return SAMPLE_WORDS.slice(0, wordIds.length || 5);
  }
}
