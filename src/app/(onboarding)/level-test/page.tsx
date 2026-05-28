'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * Phase 1.0 Level Test
 * PRD FR-01: 5문항 × 1점, 60초 타이머, 되돌리기 불가
 * 점수 매핑: 0~1=A1, 2=A2, 3=B1, 4=B2, 5=C1+
 */

type QuestionType = 'blank' | 'phrasal' | 'synonym' | 'pronunciation' | 'situation';

interface Question {
  type: QuestionType;
  prompt: string;
  options: string[];
  answer: string;  // 정답 텍스트
}

// MVP용 하드코딩 문제풀 (운영 시 콘텐츠 repo로 이동)
const POOL: Question[] = [
  { type: 'blank', prompt: 'I _____ to work every day.', options: ['go', 'goes', 'going', 'went'], answer: 'go' },
  { type: 'phrasal', prompt: '"look up to someone"의 의미는?', options: ['존경하다', '찾아보다', '쳐다보다', '포기하다'], answer: '존경하다' },
  { type: 'synonym', prompt: '"important"와 가장 가까운 단어는?', options: ['crucial', 'simple', 'easy', 'random'], answer: 'crucial' },
  { type: 'pronunciation', prompt: '다음 중 "schedule"의 미국식 발음과 가까운 것?', options: ['스케줄', '셰줄', '스케쥬얼', '스케쥴'], answer: '스케줄' },
  { type: 'situation', prompt: '회의 시작 시 동료에게 인사할 때 가장 자연스러운 표현?', options: ['Good morning, everyone', 'Hey what\'s up', 'Hi friend', 'Hello dear'], answer: 'Good morning, everyone' },
];

const LEVEL_MAP = ['A1', 'A1', 'A2', 'B1', 'B2', 'C1'] as const;

export default function LevelTestPage() {
  const router = useRouter();
  const [step, setStep] = useState<'intro' | 'quiz' | 'done'>('intro');
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [remaining, setRemaining] = useState(60);
  const [submitting, setSubmitting] = useState(false);

  // 60초 카운트다운
  useEffect(() => {
    if (step !== 'quiz') return;
    const t = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(t);
          setStep('done');
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [step]);

  function selectAnswer(option: string) {
    const correct = option === POOL[idx].answer;
    const newScore = score + (correct ? 1 : 0);
    setScore(newScore);
    if (idx + 1 >= POOL.length) {
      setStep('done');
    } else {
      setIdx(idx + 1);
    }
  }

  const [saveError, setSaveError] = useState<string | null>(null);

  async function finishAndSaveLevel() {
    setSubmitting(true);
    setSaveError(null);
    try {
      const supabase = createClient();
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) {
        setSaveError('로그인이 만료되었습니다. 다시 로그인해 주세요.');
        setSubmitting(false);
        return;
      }
      const level = LEVEL_MAP[score];
      const { error: updErr } = await supabase
        .from('profiles')
        .update({ level, last_level_test_at: new Date().toISOString() })
        .eq('id', user.id);
      if (updErr) {
        setSaveError('레벨 저장 실패. 다시 시도해 주세요.');
        setSubmitting(false);
        return;
      }
      router.push('/track-select');
    } catch (e: any) {
      console.error(e);
      setSaveError(e?.message ?? '저장 중 오류');
      setSubmitting(false);
    }
  }

  if (step === 'intro') {
    return (
      <div className="space-y-6 py-12">
        <h1 className="text-2xl font-bold">레벨 테스트</h1>
        <p className="text-gray-700">5문항 1분 안에 답하면 됩니다.<br />중간에 되돌릴 수 없어요.</p>
        <button
          onClick={() => setStep('quiz')}
          className="w-full rounded-xl bg-brand py-4 text-white font-medium"
        >
          시작 (60초)
        </button>
      </div>
    );
  }

  if (step === 'done') {
    const level = LEVEL_MAP[score];
    return (
      <div className="space-y-6 py-12 text-center">
        <h1 className="text-2xl font-bold">결과</h1>
        <p className="text-5xl font-bold text-brand">{level}</p>
        <p className="text-gray-700">{score} / {POOL.length} 정답</p>
        <p className="text-sm text-gray-500">
          {level === 'A1' && '기초 — 천천히 시작해요'}
          {level === 'A2' && '초중급 — 일상 표현부터'}
          {level === 'B1' && '중급 — 실용 표현 중심'}
          {level === 'B2' && '중상급 — 상황별 표현'}
          {level === 'C1' && '고급 — 미묘한 뉘앙스까지'}
        </p>
        <button
          onClick={finishAndSaveLevel}
          disabled={submitting}
          className="w-full rounded-xl bg-brand py-4 text-white font-medium disabled:bg-gray-400"
        >
          {submitting ? '저장 중...' : '다음'}
        </button>
        {saveError && <p className="text-sm text-red-600">{saveError}</p>}
      </div>
    );
  }

  // step === 'quiz'
  const q = POOL[idx];
  return (
    <div className="space-y-6 py-8">
      <div className="flex justify-between text-sm text-gray-500">
        <span>{idx + 1} / {POOL.length}</span>
        <span className={remaining <= 10 ? 'text-red-600 font-bold' : ''}>{remaining}초</span>
      </div>
      <h2 className="text-xl font-medium">{q.prompt}</h2>
      <div className="space-y-2">
        {q.options.map((opt) => (
          <button
            key={opt}
            onClick={() => selectAnswer(opt)}
            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-4 text-left active:bg-brand active:text-white"
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
