'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { startSyncLoop, stopSyncLoop, trackEvent } from '@/lib/sync/syncClient';

interface ReviewWord {
  word_id: string;
  next_due_at: string;
  ease_factor: number;
  interval_seconds: number;
  lapse_count: number;
  word: string;
  definition_ko: string;
  example_sentence: string | null;
}

type PageState = 'loading' | 'empty' | 'reviewing' | 'done';

export default function ReviewPage() {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [userId, setUserId] = useState<string | null>(null);
  const [words, setWords] = useState<ReviewWord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [knewCount, setKnewCount] = useState(0);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setPageState('empty');
        return;
      }
      setUserId(user.id);

      const { data, error } = await supabase
        .from('user_word_state')
        .select(
          'word_id, next_due_at, ease_factor, interval_seconds, lapse_count, words(word, definition_ko, example_sentence)'
        )
        .eq('user_id', user.id)
        .lte('next_due_at', new Date().toISOString())
        .order('next_due_at', { ascending: true })
        .limit(50);

      if (error) {
        console.warn('review fetch error:', error.message);
        setPageState('empty');
        return;
      }

      const parsed: ReviewWord[] = (data ?? [])
        .map((row: any) => {
          const w = Array.isArray(row.words) ? row.words[0] : row.words;
          if (!w) return null;
          return {
            word_id: row.word_id,
            next_due_at: row.next_due_at,
            ease_factor: row.ease_factor,
            interval_seconds: row.interval_seconds,
            lapse_count: row.lapse_count,
            word: w.word,
            definition_ko: w.definition_ko,
            example_sentence: w.example_sentence ?? null,
          };
        })
        .filter(Boolean) as ReviewWord[];

      if (parsed.length === 0) {
        setPageState('empty');
        return;
      }

      setWords(parsed);
      setPageState('reviewing');
      startSyncLoop();
    })();

    return () => {
      stopSyncLoop();
    };
  }, []);

  async function handleAnswer(knew: boolean) {
    const currentWord = words[currentIndex];
    if (!userId || !currentWord) return;

    await trackEvent({
      user_id: userId,
      event_type: 'review_completed',
      word_id: currentWord.word_id,
      payload: { knew },
    });

    const nextReviewed = reviewedCount + 1;
    const nextKnew = knewCount + (knew ? 1 : 0);
    setReviewedCount(nextReviewed);
    setKnewCount(nextKnew);

    if (currentIndex + 1 >= words.length) {
      setPageState('done');
    } else {
      setCurrentIndex(currentIndex + 1);
    }
  }

  if (pageState === 'loading') {
    return (
      <div className="flex flex-col gap-4 py-6 px-4 animate-pulse">
        <div className="h-6 w-24 rounded-full bg-gray-100 mx-auto" />
        <div className="h-48 rounded-2xl bg-gray-100" />
        <div className="flex gap-3">
          <div className="flex-1 h-14 rounded-xl bg-gray-100" />
          <div className="flex-1 h-14 rounded-xl bg-gray-100" />
        </div>
      </div>
    );
  }

  if (pageState === 'empty') {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-6 text-center gap-4">
        <p className="text-5xl">🎉</p>
        <h1 className="text-xl font-bold text-gray-800">복습할 단어가 없어요</h1>
        <p className="text-sm text-gray-500">모든 복습을 마쳤어요. 잘 하고 있어요!</p>
        <a
          href="/daily"
          className="mt-4 inline-block rounded-xl bg-brand px-6 py-3 text-white font-semibold text-sm shadow-sm"
        >
          오늘 학습으로 돌아가기
        </a>
      </div>
    );
  }

  if (pageState === 'done') {
    const total = reviewedCount;
    const ratio = total > 0 ? Math.round((knewCount / total) * 100) : 0;
    const encouragement =
      ratio >= 80
        ? '완벽해요! 계속 이 페이스를 유지하세요.'
        : ratio >= 50
        ? '잘 하고 있어요! 꾸준히 복습하면 더 좋아질 거예요.'
        : '괜찮아요! 반복 복습이 실력을 만들어요.';

    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center gap-5">
        <p className="text-5xl">✅</p>
        <h1 className="text-2xl font-bold text-gray-800">복습 완료!</h1>
        <p className="text-lg text-gray-700">
          <span className="font-semibold text-brand">{total}개</span> 단어 복습했어요
        </p>
        <div className="w-full max-w-xs bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-2">
          <div className="flex justify-between text-sm text-gray-600">
            <span>알았던 단어</span>
            <span className="font-semibold text-green-600">{knewCount}개</span>
          </div>
          <div className="flex justify-between text-sm text-gray-600">
            <span>몰랐던 단어</span>
            <span className="font-semibold text-red-500">{total - knewCount}개</span>
          </div>
          <div className="flex justify-between text-sm text-gray-600">
            <span>정답률</span>
            <span className="font-semibold text-brand">{ratio}%</span>
          </div>
        </div>
        <p className="text-sm text-gray-500 max-w-xs">{encouragement}</p>
        <a
          href="/daily"
          className="mt-2 inline-block rounded-xl bg-brand px-6 py-3 text-white font-semibold text-sm shadow-sm"
        >
          오늘 학습으로 돌아가기
        </a>
      </div>
    );
  }

  // pageState === 'reviewing'
  const currentWord = words[currentIndex];
  const total = words.length;
  const progress = Math.round(((currentIndex) / total) * 100);

  return (
    <div className="flex flex-col gap-5 py-6 px-4 min-h-screen">
      {/* Progress header */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-gray-500 shrink-0">
          {currentIndex + 1} / {total}
        </span>
        <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-2 rounded-full bg-brand transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Review card */}
      <div className="flex-1 flex flex-col gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-7 flex flex-col items-center text-center gap-5 min-h-[220px] justify-center">
          <p className="text-4xl font-bold text-gray-900 tracking-tight">
            {currentWord.word}
          </p>
          {currentWord.definition_ko && (
            <p className="text-base text-gray-500 leading-relaxed">
              {currentWord.definition_ko}
            </p>
          )}
          {currentWord.example_sentence && (
            <p className="text-xs text-gray-400 italic leading-relaxed border-t border-gray-50 pt-4 w-full text-center">
              {currentWord.example_sentence}
            </p>
          )}
        </div>

        {/* Answer buttons */}
        <div className="flex gap-3 mt-2">
          <button
            onClick={() => handleAnswer(false)}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-red-50 border border-red-100 py-4 text-base font-semibold text-red-600 active:scale-95 transition-transform"
          >
            <span>✗</span>
            <span>몰라요</span>
          </button>
          <button
            onClick={() => handleAnswer(true)}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-brand py-4 text-base font-semibold text-white shadow-sm active:scale-95 transition-transform"
          >
            <span>✓</span>
            <span>알아요</span>
          </button>
        </div>

        <p className="text-center text-xs text-gray-400 mt-1">
          알면 ✓, 떠오르지 않으면 ✗를 눌러주세요
        </p>
      </div>
    </div>
  );
}
