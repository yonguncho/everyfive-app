import { describe, it, expect } from 'vitest';
import { deriveQuality, applyReview } from '../sm2Algorithm';

describe('deriveQuality — 기존 boolean 로직 (speechScore 없음)', () => {
  it('focused + 발음 성공 → 4', () => {
    expect(deriveQuality({ mode: 'focused', speechRecognized: true, quizCorrect: null })).toBe(4);
  });

  it('focused + 발음 실패 → 2', () => {
    expect(deriveQuality({ mode: 'focused', speechRecognized: false, quizCorrect: null })).toBe(2);
  });

  it('focused + 스킵(null) → 3', () => {
    expect(deriveQuality({ mode: 'focused', speechRecognized: null, quizCorrect: null })).toBe(3);
  });

  it('quiet 모드 → 3', () => {
    expect(deriveQuality({ mode: 'quiet', speechRecognized: true, quizCorrect: null })).toBe(3);
  });

  it('퀴즈 오답 → base - 1', () => {
    expect(deriveQuality({ mode: 'focused', speechRecognized: true, quizCorrect: false })).toBe(3);
  });

  it('퀴즈 정답 → base 그대로', () => {
    expect(deriveQuality({ mode: 'focused', speechRecognized: true, quizCorrect: true })).toBe(4);
  });
});

describe('deriveQuality — speechScore 3단계 매핑 (KPI-03)', () => {
  it('speechScore 90 → quality 5', () => {
    expect(deriveQuality({ mode: 'focused', speechRecognized: true, quizCorrect: null, speechScore: 90 })).toBe(5);
  });

  it('speechScore 100 → quality 5', () => {
    expect(deriveQuality({ mode: 'focused', speechRecognized: true, quizCorrect: null, speechScore: 100 })).toBe(5);
  });

  it('speechScore 89 → quality 4', () => {
    expect(deriveQuality({ mode: 'focused', speechRecognized: true, quizCorrect: null, speechScore: 89 })).toBe(4);
  });

  it('speechScore 60 → quality 4', () => {
    expect(deriveQuality({ mode: 'focused', speechRecognized: true, quizCorrect: null, speechScore: 60 })).toBe(4);
  });

  it('speechScore 59 → quality 2', () => {
    expect(deriveQuality({ mode: 'focused', speechRecognized: true, quizCorrect: null, speechScore: 59 })).toBe(2);
  });

  it('speechScore 0 → quality 2', () => {
    expect(deriveQuality({ mode: 'focused', speechRecognized: true, quizCorrect: null, speechScore: 0 })).toBe(2);
  });

  it('speechScore 90 + quizWrong → quality 4 (5 - 1)', () => {
    expect(deriveQuality({ mode: 'focused', speechRecognized: true, quizCorrect: false, speechScore: 90 })).toBe(4);
  });

  it('speechScore undefined → 기존 boolean 로직 사용', () => {
    expect(deriveQuality({ mode: 'focused', speechRecognized: true, quizCorrect: null, speechScore: undefined })).toBe(4);
    expect(deriveQuality({ mode: 'focused', speechRecognized: false, quizCorrect: null, speechScore: undefined })).toBe(2);
  });
});

describe('applyReview — quality 3 처리 (P2 fix)', () => {
  it('quality 3: interval이 다음 사다리 스텝으로 진행', () => {
    const prevState = {
      intervalSeconds: 3600,   // 1h (사다리 인덱스 0)
      easeFactor: 2.5,
      lapseCount: 0,
      lastReviewAt: new Date('2026-01-01'),
      nextDueAt: new Date('2026-01-01T01:00:00'),
    };
    const result = applyReview({ prevState, quality: 3, now: new Date('2026-01-01T01:00:00') });
    expect(result.intervalSeconds).toBeGreaterThan(prevState.intervalSeconds);
  });

  it('quality 3: easeFactor 변화 없음', () => {
    const prevState = {
      intervalSeconds: 86400,  // 1d
      easeFactor: 2.5,
      lapseCount: 0,
      lastReviewAt: new Date('2026-01-01'),
      nextDueAt: new Date('2026-01-02'),
    };
    const result = applyReview({ prevState, quality: 3, now: new Date('2026-01-02') });
    expect(result.easeFactor).toBeCloseTo(prevState.easeFactor, 5);
  });
});

describe('applyReview — quality < 3 처리', () => {
  it('quality 2: interval 초기화 (1h) + easeFactor 감소', () => {
    const prevState = {
      intervalSeconds: 86400 * 7,  // 7d
      easeFactor: 2.5,
      lapseCount: 0,
      lastReviewAt: new Date('2026-01-01'),
      nextDueAt: new Date('2026-01-08'),
    };
    const result = applyReview({ prevState, quality: 2, now: new Date('2026-01-08') });
    expect(result.intervalSeconds).toBe(3600);       // INITIAL_INTERVAL_SECONDS = 1h
    expect(result.easeFactor).toBeCloseTo(2.3, 5);   // 2.5 - 0.2
    expect(result.lapseCount).toBe(1);
  });

  it('easeFactor 하한(1.3) 클램프: 더 이상 내려가지 않음', () => {
    const prevState = {
      intervalSeconds: 3600,
      easeFactor: 1.3,   // 이미 하한
      lapseCount: 5,
      lastReviewAt: new Date('2026-01-01'),
      nextDueAt: new Date('2026-01-01T01:00:00'),
    };
    const result = applyReview({ prevState, quality: 0, now: new Date('2026-01-01T01:00:00') });
    expect(result.easeFactor).toBe(1.3);
  });
});

describe('applyReview — BUG-02: 365일 캡', () => {
  it('200일 구간에서 ease 곱 결과가 365일을 초과하지 않음', () => {
    const prevState = {
      intervalSeconds: 86400 * 200,
      easeFactor: 2.5,
      lapseCount: 0,
      lastReviewAt: new Date('2026-01-01'),
      nextDueAt: new Date('2026-07-20'),
    };
    const result = applyReview({ prevState, quality: 5, now: new Date('2026-07-20') });
    expect(result.intervalSeconds).toBeLessThanOrEqual(86400 * 365);
  });

  it('이미 365일인 상태에서 추가 학습해도 365일 초과하지 않음', () => {
    const prevState = {
      intervalSeconds: 86400 * 365,
      easeFactor: 2.5,
      lapseCount: 0,
      lastReviewAt: new Date('2026-01-01'),
      nextDueAt: new Date('2027-01-01'),
    };
    const result = applyReview({ prevState, quality: 5, now: new Date('2027-01-01') });
    expect(result.intervalSeconds).toBeLessThanOrEqual(86400 * 365);
    expect(result.intervalSeconds).toBe(86400 * 365);
  });
});

describe('applyReview — quality 5 처리', () => {
  it('quality 5: easeFactor += 0.1 (quality 4 대비 +0.1 추가)', () => {
    const prevState = {
      intervalSeconds: 86400,
      easeFactor: 2.5,
      lapseCount: 0,
      lastReviewAt: new Date('2026-01-01'),
      nextDueAt: new Date('2026-01-02'),
    };
    const now = new Date('2026-01-02');

    const result5 = applyReview({ prevState, quality: 5, now });
    const result4 = applyReview({ prevState, quality: 4, now });

    // quality 5: easeFactor += 0.1*(5-4) = 0.1 증가
    expect(result5.easeFactor).toBeCloseTo(prevState.easeFactor + 0.1, 5);
    // quality 4: easeFactor += 0.1*(4-4) = 변화 없음
    expect(result4.easeFactor).toBeCloseTo(prevState.easeFactor, 5);
  });

  it('quality 5 성공 경로 (interval 진행)', () => {
    const prevState = {
      intervalSeconds: 3600,
      easeFactor: 2.5,
      lapseCount: 0,
      lastReviewAt: new Date('2026-01-01'),
      nextDueAt: new Date('2026-01-01T01:00:00'),
    };
    const result = applyReview({ prevState, quality: 5, now: new Date('2026-01-01T01:00:00') });
    // quality >= 3이면 interval 진행 (사다리 다음 스텝)
    expect(result.intervalSeconds).toBeGreaterThan(prevState.intervalSeconds);
  });
});
