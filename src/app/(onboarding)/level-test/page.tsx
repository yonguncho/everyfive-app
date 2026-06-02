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

// 카테고리별 문제풀 — 매 테스트마다 각 카테고리에서 1개씩 랜덤 선택
const POOL_BY_TYPE: Record<QuestionType, Question[]> = {
  blank: [
    { type: 'blank', prompt: 'I _____ to work every day.', options: ['go', 'goes', 'going', 'went'], answer: 'go' },
    { type: 'blank', prompt: 'She _____ happy when she heard the news.', options: ['is', 'was', 'were', 'be'], answer: 'was' },
    { type: 'blank', prompt: 'He _____ been working here for five years.', options: ['have', 'had', 'has', 'is'], answer: 'has' },
    { type: 'blank', prompt: 'They decided _____ the meeting until Friday.', options: ['postpone', 'postponing', 'to postpone', 'postponed'], answer: 'to postpone' },
    { type: 'blank', prompt: 'By the time we arrived, the film _____ already started.', options: ['has', 'had', 'have', 'was'], answer: 'had' },
  ],
  phrasal: [
    { type: 'phrasal', prompt: '"look up to someone"의 의미는?', options: ['존경하다', '찾아보다', '쳐다보다', '포기하다'], answer: '존경하다' },
    { type: 'phrasal', prompt: '"put off"의 의미는?', options: ['미루다', '끄다', '내려놓다', '포기하다'], answer: '미루다' },
    { type: 'phrasal', prompt: '"bring up"의 의미는?', options: ['언급하다', '가져오다', '올리다', '키우다'], answer: '언급하다' },
    { type: 'phrasal', prompt: '"run into someone"의 의미는?', options: ['충돌하다', '우연히 만나다', '빠르게 달리다', '피하다'], answer: '우연히 만나다' },
    { type: 'phrasal', prompt: '"give in"의 의미는?', options: ['제출하다', '굴복하다', '포기하다', '들어가다'], answer: '굴복하다' },
  ],
  synonym: [
    { type: 'synonym', prompt: '"important"와 가장 가까운 단어는?', options: ['crucial', 'simple', 'easy', 'random'], answer: 'crucial' },
    { type: 'synonym', prompt: '"show"와 가장 가까운 단어는?', options: ['hide', 'demonstrate', 'ignore', 'avoid'], answer: 'demonstrate' },
    { type: 'synonym', prompt: '"difficult"과 가장 가까운 단어는?', options: ['simple', 'quick', 'challenging', 'bright'], answer: 'challenging' },
    { type: 'synonym', prompt: '"end"와 가장 가까운 단어는?', options: ['begin', 'proceed', 'conclude', 'extend'], answer: 'conclude' },
    { type: 'synonym', prompt: '"help"와 가장 가까운 단어는?', options: ['hinder', 'assist', 'ignore', 'delay'], answer: 'assist' },
  ],
  pronunciation: [
    { type: 'pronunciation', prompt: '다음 중 "schedule"의 미국식 발음과 가까운 것?', options: ['스케줄', '셰줄', '스케쥬얼', '스케쥴'], answer: '스케줄' },
    { type: 'pronunciation', prompt: '"colonel"의 올바른 발음은?', options: ['콜로넬', '커널', '콜로넬', '코로넬'], answer: '커널' },
    { type: 'pronunciation', prompt: '"Wednesday"의 올바른 발음은?', options: ['웨드네스데이', '웬즈데이', '웨드즈데이', '웬드네이'], answer: '웬즈데이' },
    { type: 'pronunciation', prompt: '"debt"에서 묵음인 글자는?', options: ['d', 'e', 'b', 't'], answer: 'b' },
    { type: 'pronunciation', prompt: '"island"에서 묵음인 글자는?', options: ['i', 'l', 's', 'a'], answer: 's' },
  ],
  situation: [
    { type: 'situation', prompt: '회의 시작 시 동료에게 인사할 때 가장 자연스러운 표현?', options: ['Good morning, everyone', "Hey what's up", 'Hi friend', 'Hello dear'], answer: 'Good morning, everyone' },
    { type: 'situation', prompt: '처음 만난 사람에게 하는 가장 자연스러운 인사?', options: ['How are you doing?', 'Nice to meet you', 'Long time no see', 'What do you want?'], answer: 'Nice to meet you' },
    { type: 'situation', prompt: '이메일 마무리에 쓰는 가장 격식 있는 표현?', options: ['See ya', 'Bye bye', 'Best regards', 'Take care dude'], answer: 'Best regards' },
    { type: 'situation', prompt: '상대방 의견에 부드럽게 반대할 때 자연스러운 표현?', options: ['You are wrong', 'I disagree totally', 'I see your point, but...', 'No way'], answer: 'I see your point, but...' },
    { type: 'situation', prompt: '전화로 본인임을 밝힐 때 가장 자연스러운 표현?', options: ['It is I', 'Speaking', 'Yes, me', 'That is me'], answer: 'Speaking' },
  ],
};

function pickQuestions(): Question[] {
  const types: QuestionType[] = ['blank', 'phrasal', 'synonym', 'pronunciation', 'situation'];
  const picked = types.map((t) => {
    const pool = POOL_BY_TYPE[t];
    return pool[Math.floor(Math.random() * pool.length)];
  });
  // 문항 순서도 섞기
  for (let i = picked.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [picked[i], picked[j]] = [picked[j], picked[i]];
  }
  return picked;
}

const LEVEL_MAP = ['A1', 'A1', 'A2', 'B1', 'B2', 'C1'] as const;

export default function LevelTestPage() {
  const router = useRouter();
  const [questions] = useState<Question[]>(() => pickQuestions());
  const [step, setStep] = useState<'intro' | 'quiz' | 'done'>('intro');
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [userAnswers, setUserAnswers] = useState<string[]>([]);
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
    const correct = option === questions[idx].answer;
    setScore((s) => s + (correct ? 1 : 0));
    setUserAnswers((prev) => [...prev, option]);
    if (idx + 1 >= questions.length) {
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
    const wrongItems = questions
      .map((q, i) => ({ q, chosen: userAnswers[i] ?? '(미응답)', correct: q.answer }))
      .filter(({ chosen, correct }) => chosen !== correct);

    return (
      <div className="space-y-6 py-12">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">결과</h1>
          <p className="text-5xl font-bold text-brand">{level}</p>
          <p className="text-gray-700">{score} / {questions.length} 정답</p>
          <p className="text-sm text-gray-500">
            {level === 'A1' && '기초 — 천천히 시작해요'}
            {level === 'A2' && '초중급 — 일상 표현부터'}
            {level === 'B1' && '중급 — 실용 표현 중심'}
            {level === 'B2' && '중상급 — 상황별 표현'}
            {level === 'C1' && '고급 — 미묘한 뉘앙스까지'}
          </p>
        </div>

        {wrongItems.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500">틀린 문제 ({wrongItems.length}개)</h2>
            {wrongItems.map(({ q, chosen, correct }, i) => (
              <div key={i} className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-2">
                <p className="text-sm font-medium text-gray-800">{q.prompt}</p>
                <div className="flex items-center gap-2 text-sm">
                  <span className="shrink-0 text-red-500 font-medium">내 답</span>
                  <span className="rounded-lg bg-red-50 border border-red-200 px-2 py-0.5 text-red-700">{chosen}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="shrink-0 text-green-600 font-medium">정답</span>
                  <span className="rounded-lg bg-green-50 border border-green-200 px-2 py-0.5 text-green-700">{correct}</span>
                </div>
              </div>
            ))}
          </div>
        )}

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
  const q = questions[idx];
  return (
    <div className="space-y-6 py-8">
      <div className="flex justify-between text-sm text-gray-500">
        <span>{idx + 1} / {questions.length}</span>
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
