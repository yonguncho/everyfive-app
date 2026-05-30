'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import WordCard, { type Word } from '@/components/learning/WordCard';
import { createClient } from '@/lib/supabase/client';
import { startSyncLoop, stopSyncLoop, trackEvent } from '@/lib/sync/syncClient';
import { deriveQuality } from '@/lib/srs/sm2Algorithm';
import { SAMPLE_WORDS, fetchDailyQueue, resolveWordsByIds, fisherYates, buildBlankSentence, getDifficultyFilter, computeSeed } from '@/lib/daily/dailyQueue';
import { checkAndAwardBadges } from '@/lib/badges/checkBadges';

const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

/** 누적 활동일 수 → 도달 가능한 최고 레벨 */
function computeTargetLevel(activeDays: number): string {
  if (activeDays >= 365) return 'C2';
  if (activeDays >= 180) return 'C1';
  if (activeDays >= 90)  return 'B2';
  if (activeDays >= 30)  return 'B1';
  if (activeDays >= 7)   return 'A2';
  return 'A1';
}

async function fetchDailyWords(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  level: string,
  track: string,
  count: number,
  seed: number,
): Promise<Word[]> {
  let pool: Word[];
  try {
    const difficulty = getDifficultyFilter(level);
    const { data: rows, error } = await supabase
      .from('words')
      .select('*')
      .in('difficulty', difficulty)
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
      ipa: r.ipa ?? '',
      pronunciation_ko: r.pronunciation_ko ?? undefined,
      phrasal_verbs: [],
      scenarios: r.example_sentence
        ? [{ context: 'example', example_en: r.example_sentence, example_ko: r.example_sentence_ko ?? '' }]
        : [],
      quiz: { blank_sentence: buildBlankSentence(r.word, r.example_sentence, r.definition_ko), answer: r.word },
    }));
  } catch (e) {
    console.warn(JSON.stringify({ event: 'fetch_daily_words_failed', error: (e as Error)?.message }));
    pool = fisherYates([...SAMPLE_WORDS], seed);
  }

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

type Mode = 'focused' | 'quiet' | 'reverse';

export default function DailyPage() {
  const router = useRouter();
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
  const [toast, setToast] = useState<string | null>(null);
  const [currentLevel, setCurrentLevel] = useState<string>('A1');
  const [dueCount, setDueCount] = useState(0);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);

      const { data: profile } = await supabase
        .from('profiles')
        .select('level, track, last_level_test_at')
        .eq('id', user.id)
        .single();

      // 온보딩 미완료: 레벨 테스트 페이지로 리다이렉트
      if (!profile?.last_level_test_at) {
        router.replace('/level-test');
        return;
      }

      const { data: sub } = await supabase
        .from('subscriptions')
        .select('plan, status')
        .eq('user_id', user.id)
        .single();

      const level = profile?.level ?? 'A1';
      const track = profile?.track ?? 'daily';
      setCurrentLevel(level);

      const activeStatuses = ['ACTIVE', 'TRIAL', 'CANCELED_AT_PERIOD_END', 'PAST_DUE'];
      const plan = (sub && activeStatuses.includes(sub.status)) ? sub.plan : 'free';
      const wordCount = plan === 'pro_20' ? 20 : plan === 'pro_15' ? 15 : plan === 'pro_10' ? 10 : 5;

      const queue = await fetchDailyQueue(supabase);
      // 세션마다 다른 표시 순서를 위해 랜덤 컴포넌트 사용
      const randomPart = Math.floor(Math.random() * 0xffffffff) >>> 0;
      if (queue && queue.wordIds.length > 0) {
        const fetched = await resolveWordsByIds(queue.wordIds, supabase);
        const displaySeed = (queue.sessionSeed ^ randomPart) >>> 0;
        setWords(fisherYates([...fetched], displaySeed));
        setSessionSeed(displaySeed);
      } else {
        const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const baseSeed = computeSeed(user.id, todayKst);
        const sessionSeed = (baseSeed ^ randomPart) >>> 0;
        setSessionSeed(sessionSeed);
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
            mode: mode === 'reverse' ? 'quiet' : mode,
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

        const supabase = createClient();

        // 배지 체크
        const [profileSnap, wordCountSnap] = await Promise.allSettled([
          supabase.from('profiles').select('current_streak').eq('id', userId).single(),
          supabase.from('user_word_state').select('word_id', { count: 'exact', head: true }).eq('user_id', userId),
        ]);
        const streak = profileSnap.status === 'fulfilled' ? ((profileSnap.value.data ?? {}) as any).current_streak ?? 0 : 0;
        const totalWords = wordCountSnap.status === 'fulfilled' ? wordCountSnap.value.count ?? 0 : 0;
        const awarded = await checkAndAwardBadges(supabase, userId, streak, totalWords);
        if (awarded.length > 0) {
          showToast(`배지 획득! ${awarded.map(b => b.icon + ' ' + b.name).join(', ')}`);
        }

        // 레벨 자동 승급 체크
        // daily_stats(cron rollup) + 오늘 세션을 합산한 누적 활동일 계산
        const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const { data: dailyRows } = await supabase
          .from('daily_stats')
          .select('date')
          .eq('user_id', userId);
        const dateset = new Set((dailyRows ?? []).map((r: any) => r.date as string));
        dateset.add(todayKst); // 오늘 세션은 cron 전이라 미반영일 수 있어 직접 추가
        const activeDays = dateset.size;

        const targetLevel = computeTargetLevel(activeDays);
        if (LEVEL_ORDER.indexOf(targetLevel as any) > LEVEL_ORDER.indexOf(currentLevel as any)) {
          await supabase
            .from('profiles')
            .update({ level: targetLevel, last_level_test_at: new Date().toISOString() })
            .eq('id', userId);
          setCurrentLevel(targetLevel);
          showToast(`레벨 업! ${currentLevel} → ${targetLevel}`);
        }

        // 복습 due 단어 수 조회
        const { count: due } = await supabase
          .from('user_word_state')
          .select('word_id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .lte('next_due_at', new Date().toISOString());
        setDueCount(due ?? 0);
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
        {dueCount > 0 && (
          <a
            href="/review"
            className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-indigo-50 border border-indigo-100 px-5 py-3 text-sm font-semibold text-indigo-700"
          >
            <span>🔔</span>
            <span>복습 {dueCount}개 남았어요 → 지금 복습</span>
          </a>
        )}
        {toast && (
          <div className="fixed bottom-6 left-0 right-0 flex justify-center px-4 z-50 pointer-events-none">
            <div className="bg-gray-800 text-white text-sm px-4 py-3 rounded-xl shadow-lg">
              {toast}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="py-4">
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm text-gray-500">{idx + 1} / {words.length}</span>
        <button
          onClick={() => setMode(mode === 'focused' ? 'quiet' : mode === 'quiet' ? 'reverse' : 'focused')}
          className="text-xs rounded-full bg-gray-100 px-3 py-1.5"
        >
          {mode === 'focused' ? '🔊 집중' : mode === 'quiet' ? '🤫 조용한' : '🔄 역방향'}
        </button>
      </div>

      <WordCard
        key={words[idx].word_id}
        word={words[idx]}
        mode={mode}
        onComplete={onWordComplete}
        onPermissionDenied={() => {
          setMode('quiet');
          showToast('마이크 사용 불가 — 조용한 모드로 전환했습니다');
        }}
      />

      {toast && (
        <div className="fixed bottom-6 left-0 right-0 flex justify-center px-4 z-50 pointer-events-none">
          <div className="bg-gray-800 text-white text-sm px-4 py-3 rounded-xl shadow-lg">
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}
