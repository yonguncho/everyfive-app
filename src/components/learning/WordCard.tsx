'use client';

import { useEffect, useRef, useState } from 'react';
import { isSupported, recognizeWord, speak, type RecognitionResult } from '@/lib/speech/webSpeech';

export interface Word {
  word_id: string;
  word: string;
  // DB 신규 필드 (optional - SAMPLE_WORDS 호환)
  definition_ko?: string;
  definition_en?: string;
  example_sentence?: string;
  difficulty?: number;
  category?: string;
  // 기존 필드
  level?: string;
  track?: string;
  meaning_ko: string;       // WordCard 필수 (DB에서는 definition_ko로 채움)
  ipa: string;              // WordCard 필수
  pronunciation_ko?: string;
  phrasal_verbs: { phrase: string; meaning_ko: string }[];
  scenarios: { context: string; example_en: string; example_ko: string }[];
  quiz: { blank_sentence: string; answer: string; options?: string[] };
}

const CONTEXT_KO: Record<string, string> = {
  meeting: '회의', lunch: '점심', email: '이메일',
  interview: '면접', presentation: '발표',
};

interface Props {
  word: Word;
  mode: 'focused' | 'quiet';
  onComplete: (result: {
    recognitionResult: 'success' | 'failed' | 'skipped';
    quizCorrect: boolean | null;
    speechScore?: number;
  }) => void;
}

type Step = 'meaning' | 'pronunciation' | 'phrasal' | 'scenarios' | 'quiz';
const ORDER: Step[] = ['meaning', 'pronunciation', 'phrasal', 'scenarios', 'quiz'];

export default function WordCard({ word, mode, onComplete }: Props) {
  const [step, setStep] = useState<Step>('meaning');
  const [recognitionResult, setRecognitionResult] = useState<'pending' | 'success' | 'failed' | 'skipped'>('pending');
  const [quizCorrect, setQuizCorrect] = useState<boolean | null>(null);
  const [speechScore, setSpeechScore] = useState<number | undefined>(undefined);

  function advance(quizResult?: boolean | null) {
    const i = ORDER.indexOf(step);
    if (i + 1 >= ORDER.length) {
      onComplete({
        recognitionResult: recognitionResult === 'pending' ? 'skipped' : recognitionResult,
        quizCorrect: quizResult !== undefined ? quizResult : quizCorrect,
        speechScore,
      });
    } else {
      setStep(ORDER[i + 1]);
    }
  }

  const currentStepIdx = ORDER.indexOf(step);

  return (
    <div className="rounded-2xl bg-white shadow-sm p-6 min-h-[420px]">
      {/* Step indicator */}
      <div className="flex gap-1 mb-6">
        {ORDER.map((s, i) => (
          <div
            key={s}
            className={`h-1 flex-1 rounded ${i <= currentStepIdx ? 'bg-brand' : 'bg-gray-200'}`}
          />
        ))}
      </div>

      {step === 'meaning' && <MeaningStep word={word} onNext={advance} />}
      {step === 'pronunciation' && (
        <PronunciationStep
          word={word}
          mode={mode}
          onResult={(r, score) => {
            setRecognitionResult(r);
            setSpeechScore(score);
            advance();
          }}
        />
      )}
      {step === 'phrasal' && <PhrasalStep word={word} onNext={advance} />}
      {step === 'scenarios' && <ScenariosStep word={word} onNext={advance} />}
      {step === 'quiz' && (
        <QuizStep
          word={word}
          onResult={(r) => {
            setQuizCorrect(r);
            advance(r);
          }}
        />
      )}
    </div>
  );
}

/* ============ Step components ============ */

function MeaningStep({ word, onNext }: { word: Word; onNext: () => void }) {
  const [imageUrl, setImageUrl] = useState<string | null | undefined>(undefined);
  const [photographer, setPhotographer] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/word-image?word=' + encodeURIComponent(word.word))
      .then((r) => r.json())
      .then((d) => {
        setImageUrl(d.image_url ?? null);
        setPhotographer(d.photographer ?? null);
      })
      .catch(() => setImageUrl(null));
  }, [word.word]);

  return (
    <div className="space-y-4">
      <div className="text-xs text-gray-500">단어</div>
      {imageUrl === undefined && (
        <div className="w-full h-32 rounded-xl bg-gray-100 animate-pulse mb-2" />
      )}
      {typeof imageUrl === 'string' && (
        <div className="mb-2">
          <img
            src={imageUrl}
            alt={word.word}
            className="w-full h-32 object-cover rounded-xl"
          />
          {photographer && (
            <div className="text-xs text-gray-400 mt-1">Photo by {photographer} / Unsplash</div>
          )}
        </div>
      )}
      <h2 className="text-4xl font-bold">{word.word}</h2>
      <div className="text-sm text-gray-500">{word.ipa}</div>
      {word.pronunciation_ko && (
        <div className="text-sm text-gray-400">[{word.pronunciation_ko}]</div>
      )}
      <div className="text-lg text-gray-800 pt-2">{word.meaning_ko}</div>
      <button
        onClick={onNext}
        className="w-full rounded-xl bg-brand py-3 text-white font-medium mt-6"
      >
        들어볼게요
      </button>
    </div>
  );
}

function PronunciationStep({
  word, mode, onResult,
}: {
  word: Word;
  mode: 'focused' | 'quiet';
  onResult: (r: 'success' | 'failed' | 'skipped', score?: number) => void;
}) {
  const [phase, setPhase] = useState<'listening' | 'speaking' | 'analyzing' | 'done'>('listening');
  const [error, setError] = useState<string | null>(null);
  const [recogResult, setRecogResult] = useState<RecognitionResult | null>(null);
  const firedRef = useRef(false);

  function safeOnResult(r: 'success' | 'failed' | 'skipped', score?: number) {
    if (firedRef.current) return;
    firedRef.current = true;
    onResult(r, score);
  }

  async function playTts() {
    setPhase('listening');
    await speak(word.word);
  }

  useEffect(() => { playTts(); /* eslint-disable-next-line */ }, []);

  async function tryRecognize() {
    if (!isSupported()) {
      setError('이 브라우저는 발음 인식을 지원하지 않아요');
      setPhase('done');
      setTimeout(() => safeOnResult('skipped'), 1500);
      return;
    }
    setError(null);
    setPhase('speaking');
    const r = await recognizeWord({ expectedWord: word.word });

    if (r.error === 'permission_denied') {
      setError('마이크 권한이 필요해요. 브라우저 설정에서 허용 후 다시 시도해주세요.');
      setPhase('done');
      return; // 자동 진행 안 함 — 건너뛰기 버튼으로 직접 Skip
    }
    if (r.error === 'unsupported') {
      setError('이 브라우저는 발음 인식을 지원하지 않아요');
      setPhase('done');
      setTimeout(() => safeOnResult('skipped'), 1500);
      return;
    }
    if (r.error === 'aborted' || r.error === 'audio_capture') {
      setError('마이크 연결 오류예요. 다시 시도하거나 건너뛰기를 눌러주세요.');
      setPhase('done');
      return; // 자동 진행 안 함 — 재시도 또는 건너뛰기
    }

    setPhase('analyzing');
    setTimeout(() => {
      setRecogResult(r.result ?? null);
      setPhase('done');
      // 말소리를 전혀 감지 못한 경우(no_speech 3회 소진)
      if (!r.result?.text) {
        setError('말소리를 인식하지 못했어요. 다시 시도하거나 건너뛰기를 눌러주세요.');
        return;
      }
      // 발음은 됐지만 단어 불일치 — 자동 진행 금지, 재시도 유도
      if (!r.result.matched) {
        setError(`"${r.result.text}" 로 인식됐어요. 다시 시도하거나 건너뛰기를 눌러주세요.`);
        return;
      }
      safeOnResult('success', r.result.score);
    }, 400);
  }

  return (
    <div className="space-y-4 text-center">
      <div className="text-xs text-gray-500">발음</div>
      <h2 className="text-3xl font-bold">{word.word}</h2>
      <div className="text-sm text-gray-500">{word.ipa}</div>
      {word.pronunciation_ko && (
        <div className="text-sm text-gray-400">[{word.pronunciation_ko}]</div>
      )}

      {/* 발음 점수 UI — confidence 지원 브라우저에서만 표시 */}
      {recogResult?.score !== undefined && (
        <div aria-live="polite" className="rounded-xl bg-gray-50 p-4 space-y-1">
          <span className="text-2xl font-bold">{recogResult.score}점</span>
          <p className="text-sm text-gray-600">{recogResult.scoreLabel}</p>
        </div>
      )}

      <div className="py-6">
        <button
          onClick={playTts}
          className="rounded-full bg-gray-100 px-4 py-2 text-sm"
        >
          🔊 다시 듣기
        </button>
      </div>

      {mode === 'focused' ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">아래 버튼을 누르고 따라 말해보세요</p>
          <button
            onClick={tryRecognize}
            disabled={phase === 'speaking' || phase === 'analyzing'}
            className="w-full rounded-xl bg-brand py-3 text-white font-medium disabled:bg-gray-400"
          >
            {phase === 'speaking' && '듣는 중... 말해주세요'}
            {phase === 'analyzing' && '분석 중...'}
            {(phase === 'listening' || phase === 'done') && '🎤 발음하기'}
          </button>
          <button onClick={() => safeOnResult('skipped')} className="text-sm text-gray-500 underline">
            건너뛰기
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">조용한 모드 — 입모양만 따라하기</p>
          <button
            onClick={() => safeOnResult('skipped')}
            className="w-full rounded-xl bg-brand py-3 text-white font-medium"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}

function PhrasalStep({ word, onNext }: { word: Word; onNext: () => void }) {
  return (
    <div className="space-y-4">
      <div className="text-xs text-gray-500">관련 표현</div>
      <h3 className="text-lg font-medium">{word.word} 자주 같이 쓰는 표현</h3>
      <ul className="space-y-3">
        {word.phrasal_verbs.map((p) => (
          <li key={p.phrase} className="rounded-xl bg-gray-50 p-3">
            <div className="font-bold">{p.phrase}</div>
            <div className="text-sm text-gray-600">{p.meaning_ko}</div>
          </li>
        ))}
      </ul>
      <button onClick={onNext} className="w-full rounded-xl bg-brand py-3 text-white font-medium mt-4">
        실제 상황 보기
      </button>
    </div>
  );
}

function ScenariosStep({ word, onNext }: { word: Word; onNext: () => void }) {
  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500">실제 상황</div>
      {word.scenarios.map((s, i) => (
        <div key={i} className="rounded-xl bg-gray-50 p-3">
          <div className="text-xs font-medium text-brand mb-1">
            {CONTEXT_KO[s.context] ?? s.context}
          </div>
          <div className="text-base">"{s.example_en}"</div>
          <div className="text-sm text-gray-600 mt-1">{s.example_ko}</div>
        </div>
      ))}
      <button onClick={onNext} className="w-full rounded-xl bg-brand py-3 text-white font-medium mt-4">
        퀴즈
      </button>
    </div>
  );
}

function QuizStep({ word, onResult }: { word: Word; onResult: (correct: boolean) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);

  const hasOptions = word.quiz.options && word.quiz.options.length > 0;

  function normalize(s: string) {
    return s.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function submit(answer: string) {
    const correct = normalize(answer) === normalize(word.quiz.answer);
    setIsCorrect(correct);
    setSubmitted(true);
    // 정답 시에만 자동 진행 — 오답은 "확인하고 다음으로" 버튼으로 명시적 진행
    if (correct) {
      setTimeout(() => onResult(true), 800);
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-gray-500">퀴즈</div>
      <p className="text-lg font-medium">{word.quiz.blank_sentence.replace('_____', '___')}</p>

      {hasOptions ? (
        <div className="grid grid-cols-2 gap-2">
          {word.quiz.options!.map((opt) => {
            const isCorrectOpt = normalize(opt) === normalize(word.quiz.answer);
            const isSelected = selected === opt;
            let cls = 'border-gray-200 bg-white hover:bg-gray-50';
            if (submitted) {
              if (isCorrectOpt) cls = 'border-green-500 bg-green-50 text-green-700';
              else if (isSelected) cls = 'border-red-500 bg-red-50 text-red-700';
            }
            return (
              <button
                key={opt}
                disabled={submitted}
                onClick={() => { setSelected(opt); submit(opt); }}
                className={`rounded-xl border py-3 px-2 text-sm font-medium transition-colors ${cls}`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && input && !submitted) submit(input); }}
            disabled={submitted}
            placeholder="빈칸에 들어갈 표현"
            className="w-full rounded-xl border border-gray-300 px-4 py-3"
          />
          {!submitted && (
            <button
              onClick={() => submit(input)}
              disabled={!input}
              className="w-full rounded-xl bg-brand py-3 text-white font-medium disabled:bg-gray-400"
            >
              확인
            </button>
          )}
        </>
      )}

      {submitted && isCorrect !== null && (
        <p className={`text-sm font-medium ${isCorrect ? 'text-green-600' : 'text-red-600'}`}>
          {isCorrect ? '정답!' : `오답 — 정답: ${word.quiz.answer}`}
        </p>
      )}

      {/* 오답: 정답을 확인하고 명시적으로 다음 단어로 넘어가야 함 */}
      {submitted && isCorrect === false && (
        <button
          onClick={() => onResult(false)}
          className="w-full rounded-xl bg-gray-500 py-3 text-white font-medium"
        >
          확인하고 다음으로
        </button>
      )}
    </div>
  );
}
