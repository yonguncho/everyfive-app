'use client';

import { useEffect, useState } from 'react';
import WordCard, { type Word } from '@/components/learning/WordCard';
import { createClient } from '@/lib/supabase/client';
import { startSyncLoop, stopSyncLoop, trackEvent } from '@/lib/sync/syncClient';
import { deriveQuality } from '@/lib/srs/sm2Algorithm';
import { SAMPLE_WORDS, fetchDailyQueue, resolveWordsByIds, fisherYates } from '@/lib/daily/dailyQueue';


async function fetchDailyWords(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  level: string,
  track: string,
  count: number,
  seed: number,
): Promise<Word[]> {
  // CDN 제거 → Supabase words 테이블에서 직접 조회
  let pool: Word[];
  try {
    const { data: rows, error } = await supabase
      .from('words')
      .select('*')
      .order('word_id')
      .limit(count * 3);

    if (error || !rows || rows.length === 0) throw new Error('no words');
    pool = rows.map((r: any): Word => ({
      word_id: r.word_id,
      word: r.word,
      definition_ko: r.definition_ko,
      definition_en: r.definition_en,
      example_sentence: r.example_sentence,
      difficulty: r.difficulty,
      category: r.category,
      meaning_ko: r.definition_ko,
      ipa: '',
      phrasal_verbs: [],
      scenarios: r.example_sentence
        ? [{ context: 'example', example_en: r.example_sentence, example_ko: '' }]
        : [],
      quiz: { blank_sentence: '_____', answer: r.word },
    }));
  } catch (e) {
    console.warn(JSON.stringify({ event: 'fetch_daily_words_failed', error: (e as Error)?.message }));
    pool = SAMPLE_WORDS;
  }

  // SM-2 due_date 기반 복습 단어 우선 선정
  const { data: dueStates } = await supabase
    .from('user_word_state')
    .select('word_id')
    .eq('user_id', userId)
    .lte('next_due_at', new Date().toISOString());

  const dueIds = new Set((dueStates ?? []).map((s: any) => s.word_id as string));
  const dueWords  = pool.filter((w) => dueIds.has(w.word_id));
  const newWords  = pool.filter((w) => !dueIds.has(w.word_id));

  const shuffledDue = fisherYates(dueWords, seed);
  const shuffledNew = fisherYates(newWords, seed ^ 0x5f3759df);

  const result = [...shuffledDue, ...shuffledNew].slice(0, count);
  return result.length > 0 ? result : fisherYates(SAMPLE_WORDS, seed).slice(0, count);
}

type Mode = 'focused' | 'quiet';

export default function DailyPage() {
  const [sessionSeed, setSessionSeed] = useState<number>(
    () => ((Date.now() * 0x9e3779b9) ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
  );
  const [mode, setMode] = useState<Mode>(() => {
    const hour = new Date().getHours();
    return (hour >= 7 && hour < 10) || (hour >= 17 && hour < 20) ? 'quiet' : 'focused';
  });
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [words, setWords] = useState<Word[]>(SAMPLE_WORDS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);

      // 프로필에서 level/track/plan 가져오기
      const { data: profile } = await supabase
        .from('profiles')
        .select('level, track')
        .eq('id', user.id)
        .single();
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('plan, status')
        .eq('user_id', user.id)
        .single();

      const level = profile?.level ?? 'A1';
      const track = profile?.track ?? 'daily';
      const activeStatuses = ['ACTIVE', 'TRIAL', 'CANCELED_AT_PERIOD_END', 'PAST_DUE'];
      const plan = (sub && activeStatuses.includes(sub.status)) ? sub.plan : 'free';
      const wordCount = plan === 'pro_30' ? 30 : plan === 'pro_20' ? 20 : plan === 'pro_10' ? 10 : 5;

      // daily_queue Edge Function 우선 시도, 실패 시 기존 로직 fallback
      const queue = await fetchDailyQueue(supabase);
      if (queue) {
        const fetched = await resolveWordsByIds(
          queue.wordIds,
          supabase,
        );
        setWords(fetched);
        setSessionSeed(queue.sessionSeed);
      } else {
        // graceful fallback: 기존 클라이언트 로직
        const fetched = await fetchDailyWords(supabase, user.id, level, track, wordCount, sessionSeed);
        setWords(fetched);
      }

      setLoading(false);

      startSyncLoop();
      await trackEvent({
        user_id: user.id,
        event_type: 'session_start',
        payload: { mode },
      });
    })();
    return () => { stopSyncLoop(); };
    // WHY: session_start는 마운트 시점 1회만 발행해야 함.
    // mode를 deps에 추가하면 mode 토글 시마다 재발행되어 SRS 집계 오염.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onWordComplete(result: { recognitionResult: 'success'|'failed'|'skipped'; quizCorrect: boolean | null; speechScore?: number }) {
    const currentWord = words[idx];
    if (userId) {
      await trackEvent({
        user_id: userId,
        event_type: 'word_learned',
        word_id: currentWord.word_id,
        payload: {
          mode,
          recognition: result.recognitionResult,
          quiz_correct: result.quizCorrect,
          quality: deriveQuality({
            mode,
            speechRecognized: result.recognitionResult === 'success' ? true : result.recognitionResult === 'skipped' ? null : false,
            quizCorrect: result.quizCorrect,
            speechScore: result.speechScore,
          }),
        },
      });
    }
    if (idx + 1 >= words.length) {
      if (userId) {
        await trackEvent({ user_id: userId, event_type: 'session_end', payload: { mode, completed: words.length } });
      }
      setDone(true);
    } else {
      setIdx(idx + 1);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 py-4 animate-pulse">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-xl bg-gray-100" />
        ))}
      </div>
    );
  }

  if (words.length === 0) {
    return (
      <div className="py-12 text-center text-gray-500 text-sm">오늘 학습할 단어가 없어요.</div>
    );
  }

  if (done) {
    return (
      <div className="space-y-6 py-12 text-center">
        <div className="text-6xl">🎉</div>
        <h1 className="text-2xl font-bold">오늘의 {words.length}단어 완료!</h1>
        <p className="text-gray-700">내일 같은 시간에 다시 만나요.</p>
        <a href="/progress" className="block text-brand underline">진행도 보기</a>
      </div>
    );
  }

  return (
    <div className="py-4">
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm text-gray-500">{idx + 1} / {words.length}</span>
        <button
          onClick={() => setMode(mode === 'focused' ? 'quiet' : 'focused')}
          className="text-xs rounded-full bg-gray-100 px-3 py-1.5"
        >
          {mode === 'focused' ? '🔊 집중' : '🤫 조용한'}
        </button>
      </div>

      <WordCard
        key={words[idx].word_id}
        word={words[idx]}
        mode={mode}
        onComplete={onWordComplete}
      />
    </div>
  );
}
