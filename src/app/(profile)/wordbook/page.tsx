'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// DB에서 조회한 단어 상태 타입
interface WordState {
  word_id: string;
  ease_factor: number;
  interval_seconds: number;
  lapse_count: number;
  next_due_at: string | null;
  words: {
    word: string;
    definition_ko: string;
    category: string | null;
  } | null;
}

// 마스터리 탭 타입
type MasteryTab = 'mastered' | 'in_progress' | 'struggling';

// 단어를 가장 심각한 카테고리 하나로 분류
function classifyWord(state: WordState): MasteryTab {
  if (state.lapse_count >= 2) return 'struggling';
  if (state.ease_factor >= 2.8 && state.interval_seconds >= 604800) return 'mastered';
  return 'in_progress';
}

// ease_factor를 0~5 범위의 레벨(1~5)로 변환
function easeToLevel(easeFactor: number): number {
  if (easeFactor >= 2.8) return 5;
  if (easeFactor >= 2.4) return 4;
  if (easeFactor >= 2.0) return 3;
  if (easeFactor >= 1.6) return 2;
  return 1;
}

const TAB_CONFIG: { key: MasteryTab; label: string; emptyMsg: string }[] = [
  { key: 'mastered',    label: '마스터',    emptyMsg: '아직 마스터한 단어가 없어요. 꾸준히 복습하면 곧 생겨요!' },
  { key: 'in_progress', label: '학습 중',   emptyMsg: '학습 중인 단어가 없어요. 오늘 학습을 시작해 보세요!' },
  { key: 'struggling',  label: '어려운 단어', emptyMsg: '어려운 단어가 없어요. 훌륭해요!' },
];

const LEVEL_COLORS = ['bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-blue-400', 'bg-brand'];

export default function WordbookPage() {
  const [loading, setLoading] = useState(true);
  const [words, setWords] = useState<Record<MasteryTab, WordState[]>>({
    mastered: [],
    in_progress: [],
    struggling: [],
  });
  const [activeTab, setActiveTab] = useState<MasteryTab>('in_progress');
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    async function loadWords() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('user_word_state')
        .select('word_id, ease_factor, interval_seconds, lapse_count, next_due_at, words(word, definition_ko, category)')
        .eq('user_id', user.id)
        .order('ease_factor', { ascending: false });

      if (error || !data) {
        setLoading(false);
        return;
      }

      const grouped: Record<MasteryTab, WordState[]> = {
        mastered: [],
        in_progress: [],
        struggling: [],
      };

      for (const state of data as unknown as WordState[]) {
        const tab = classifyWord(state);
        grouped[tab].push(state);
      }

      setWords(grouped);
      setTotalCount(data.length);
      setLoading(false);
    }

    loadWords();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-400 text-sm animate-pulse">단어장 불러오는 중...</div>
      </div>
    );
  }

  const activeWords = words[activeTab];

  return (
    <div className="max-w-md mx-auto pb-24">
      {/* 헤더 */}
      <div className="px-4 pt-8 pb-4">
        <h1 className="text-xl font-bold text-gray-900">단어장</h1>
        <p className="text-sm text-gray-500 mt-1">총 {totalCount}개 단어 학습 중</p>
      </div>

      {/* 탭 버튼 */}
      <div className="flex border-b border-gray-200 px-4">
        {TAB_CONFIG.map(({ key, label }) => {
          const count = words[key].length;
          const isActive = activeTab === key;
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 pb-3 pt-2 text-sm transition-colors
                ${isActive
                  ? 'text-brand font-semibold border-b-2 border-brand'
                  : 'text-gray-500 font-normal border-b-2 border-transparent'
                }`}
            >
              {label}
              <span
                className={`inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-medium min-w-[20px]
                  ${isActive ? 'bg-brand text-white' : 'bg-gray-100 text-gray-500'}`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* 단어 카드 목록 */}
      <div className="px-4 mt-4 space-y-3">
        {activeWords.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <span className="text-4xl mb-3">
              {activeTab === 'mastered' ? '🏆' : activeTab === 'struggling' ? '💪' : '📖'}
            </span>
            <p className="text-gray-500 text-sm leading-relaxed max-w-xs">
              {TAB_CONFIG.find(t => t.key === activeTab)?.emptyMsg}
            </p>
          </div>
        ) : (
          activeWords.map((state) => {
            const word = state.words;
            if (!word) return null;
            const level = easeToLevel(state.ease_factor);
            return (
              <div
                key={state.word_id}
                className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-3"
              >
                {/* 텍스트 영역 */}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 text-base truncate">{word.word}</p>
                  <p className="text-gray-500 text-sm mt-0.5 truncate">{word.definition_ko}</p>
                  {word.category && (
                    <span className="inline-block mt-1 text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
                      {word.category}
                    </span>
                  )}
                </div>

                {/* 레벨 표시기 */}
                <div className="flex flex-col items-center gap-1 flex-shrink-0">
                  <div className="flex gap-0.5 items-end h-5">
                    {[1, 2, 3, 4, 5].map((bar) => (
                      <div
                        key={bar}
                        className={`w-1.5 rounded-sm transition-all
                          ${bar <= level ? LEVEL_COLORS[level - 1] : 'bg-gray-200'}
                        `}
                        style={{ height: `${bar * 4}px` }}
                      />
                    ))}
                  </div>
                  <span className="text-xs text-gray-400">Lv.{level}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
