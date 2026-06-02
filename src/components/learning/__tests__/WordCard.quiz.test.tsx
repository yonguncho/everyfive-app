import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import WordCard, { type Word } from '../WordCard';

vi.mock('@/lib/speech/webSpeech', () => ({
  isSupported: () => false,
  recognizeWord: vi.fn(),
  speak: vi.fn().mockResolvedValue(undefined),
}));

const BASE_WORD: Omit<Word, 'quiz'> = {
  word_id: 'test-id',
  word: 'focus',
  meaning_ko: '집중하다',
  ipa: '/ˈfoʊkəs/',
  phrasal_verbs: [],
  scenarios: [],
};

const WORD_MCQ: Word = {
  ...BASE_WORD,
  quiz: {
    blank_sentence: 'Try to _____ on your work.',
    answer: 'focus',
    options: ['focus', 'forget', 'follow', 'force'],
  },
};

const WORD_TEXT: Word = {
  ...BASE_WORD,
  quiz: { blank_sentence: 'Try to _____ on your work.', answer: 'focus' },
};

/** 단어 카드의 모든 앞 단계를 거쳐 퀴즈 스텝까지 도달
 *  BASE_WORD는 phrasal_verbs=[], scenarios=[] 이므로 해당 스텝은 자동 스킵됨 */
async function goToQuiz(word: Word, onComplete: ReturnType<typeof vi.fn>) {
  render(<WordCard word={word} mode="focused" onComplete={onComplete} />);

  // meaning step → "들어볼게요" 클릭
  fireEvent.click(screen.getByText('들어볼게요'));

  // pronunciation step: isSupported=false 이므로 "발음하기" 클릭 → 1.5s 후 자동 skip
  fireEvent.click(screen.getByText('🎤 발음하기'));
  await act(async () => { vi.advanceTimersByTime(1600); });

  // phrasal/scenarios는 빈 배열이라 ORDER에 포함되지 않음 — 바로 quiz 스텝
}

describe('QuizStep — 사지선다', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it('정답 선택 → 800ms 후 onComplete(quizCorrect: true) 호출', async () => {
    const onComplete = vi.fn();
    await goToQuiz(WORD_MCQ, onComplete);

    // 정답('focus') 버튼 클릭
    const buttons = screen.getAllByRole('button');
    const focusBtn = buttons.find(b => b.textContent === 'focus');
    expect(focusBtn).toBeDefined();
    fireEvent.click(focusBtn!);

    // 800ms 전: 아직 onComplete 미호출
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(onComplete).not.toHaveBeenCalled();

    // 800ms 후: onComplete 호출
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ quizCorrect: true }),
    );
  });

  it('오답 선택 → onComplete 자동 호출 안 됨 + "확인하고 다음으로" 버튼 등장', async () => {
    const onComplete = vi.fn();
    await goToQuiz(WORD_MCQ, onComplete);

    const forgetBtn = screen.getAllByRole('button').find(b => b.textContent === 'forget');
    fireEvent.click(forgetBtn!);

    // 2초 후에도 onComplete 미호출
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(onComplete).not.toHaveBeenCalled();

    // 오답 피드백 표시
    expect(screen.getByText(/오답/)).toBeInTheDocument();

    // "확인하고 다음으로" 버튼 등장
    expect(screen.getByText('확인하고 다음으로')).toBeInTheDocument();
  });

  it('오답 후 "확인하고 다음으로" 클릭 → onComplete(quizCorrect: false) 호출', async () => {
    const onComplete = vi.fn();
    await goToQuiz(WORD_MCQ, onComplete);

    const forgetBtn = screen.getAllByRole('button').find(b => b.textContent === 'forget');
    fireEvent.click(forgetBtn!);
    await act(async () => { vi.advanceTimersByTime(100); });

    fireEvent.click(screen.getByText('확인하고 다음으로'));

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ quizCorrect: false }),
    );
  });
});

describe('QuizStep — 텍스트 입력', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it('정답 입력 → 800ms 후 onComplete(quizCorrect: true)', async () => {
    const onComplete = vi.fn();
    await goToQuiz(WORD_TEXT, onComplete);

    fireEvent.change(screen.getByPlaceholderText('빈칸에 들어갈 표현'), { target: { value: 'focus' } });
    fireEvent.click(screen.getByText('확인'));

    await act(async () => { vi.advanceTimersByTime(500); });
    expect(onComplete).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ quizCorrect: true }));
  });

  it('오답 입력 → "확인" 버튼 사라짐 + 자동 진행 안 됨 + 오답 피드백 표시', async () => {
    const onComplete = vi.fn();
    await goToQuiz(WORD_TEXT, onComplete);

    fireEvent.change(screen.getByPlaceholderText('빈칸에 들어갈 표현'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByText('확인'));

    await act(async () => { vi.advanceTimersByTime(2000); });

    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.queryByText('확인')).not.toBeInTheDocument();
    expect(screen.getByText(/오답/)).toBeInTheDocument();
    expect(screen.getByText('확인하고 다음으로')).toBeInTheDocument();
  });

  it('오답 후 "확인하고 다음으로" → onComplete(quizCorrect: false)', async () => {
    const onComplete = vi.fn();
    await goToQuiz(WORD_TEXT, onComplete);

    fireEvent.change(screen.getByPlaceholderText('빈칸에 들어갈 표현'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByText('확인'));
    await act(async () => { vi.advanceTimersByTime(100); });

    fireEvent.click(screen.getByText('확인하고 다음으로'));

    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ quizCorrect: false }));
  });
});
