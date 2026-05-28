/**
 * SM-2 변형 SRS 알고리즘
 * Architecture v4 ADR-04: Snapshot-first Incremental update
 */
import { SPEECH_SCORE_PERFECT, SPEECH_SCORE_GOOD } from '../constants/speechScore';
/**
 *
 * Quality 매핑 (Mode 별):
 *  - focused + 발음 인식 성공: 4
 *  - focused + 발음 인식 실패(3회): 2
 *  - focused + 마이크 권한 거부: 3
 *  - quiet 모드: 3
 *  - 미지원 브라우저: 3
 *  - 퀴즈 오답: quality -1 (min 0)
 */

export interface SrsState {
  intervalSeconds: number;
  easeFactor: number;
  lapseCount: number;
  lastReviewAt: Date;
  nextDueAt: Date;
}

export interface ReviewInput {
  prevState: SrsState | null;
  quality: number;  // 0~5
  now: Date;
}

const MIN_EASE = 1.3;
const INITIAL_INTERVAL_SECONDS = 3600;  // 1h
const INTERVAL_LADDER_SECONDS = [
  3600,        // 1h
  86400,       // 1d
  86400 * 3,   // 3d
  86400 * 7,   // 7d
  86400 * 14,  // 14d
  86400 * 30,  // 30d
  86400 * 60,  // 60d
];

export function applyReview(input: ReviewInput): SrsState {
  const { prevState, quality, now } = input;

  // 신규 단어 (state 없음): 첫 학습 → 1h 후 복습
  if (!prevState) {
    return {
      intervalSeconds: INITIAL_INTERVAL_SECONDS,
      easeFactor: 2.5,
      lapseCount: quality < 3 ? 1 : 0,
      lastReviewAt: now,
      nextDueAt: addSeconds(now, INITIAL_INTERVAL_SECONDS),
    };
  }

  let { intervalSeconds, easeFactor, lapseCount } = prevState;

  // Quality 3 미만 = 실패 → interval 초기화
  if (quality < 3) {
    return {
      intervalSeconds: INITIAL_INTERVAL_SECONDS,
      easeFactor: Math.max(MIN_EASE, easeFactor - 0.2),
      lapseCount: lapseCount + 1,
      lastReviewAt: now,
      nextDueAt: addSeconds(now, INITIAL_INTERVAL_SECONDS),
    };
  }

  // Quality 3 = 한 칸 진행, ease 유지 / 4+ = 간격 증가
  if (quality === 3) {
    // interval 한 단계 진행, ease 변화 없음
    intervalSeconds = nextInterval(intervalSeconds, easeFactor);
  } else {
    // quality 4 또는 5: interval 증가, ease 상향 가능
    easeFactor = easeFactor + 0.1 * (quality - 4);
    intervalSeconds = nextInterval(intervalSeconds, easeFactor);
  }

  return {
    intervalSeconds,
    easeFactor,
    lapseCount,
    lastReviewAt: now,
    nextDueAt: addSeconds(now, intervalSeconds),
  };
}

function nextInterval(currentSeconds: number, ease: number): number {
  // 사다리 위 인덱스 찾기
  const idx = INTERVAL_LADDER_SECONDS.findIndex((s) => s > currentSeconds);
  if (idx === -1) {
    // 60d+ 구간: ease 곱하기
    return Math.round(currentSeconds * ease);
  }
  return INTERVAL_LADDER_SECONDS[idx];
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

/** Mode + 결과로부터 SRS quality 도출 */
export function deriveQuality(opts: {
  mode: 'focused' | 'quiet';
  speechRecognized: boolean | null;  // null = skipped
  quizCorrect: boolean | null;
  speechScore?: number;  // 0~100, undefined이면 기존 boolean 로직 유지
}): number {
  const { mode, speechRecognized, quizCorrect, speechScore } = opts;
  let base: number;

  if (speechScore !== undefined) {
    // 발음 점수 3단계 매핑
    base = speechScore >= SPEECH_SCORE_PERFECT ? 5
         : speechScore >= SPEECH_SCORE_GOOD    ? 4
         : 2;
  } else if (mode === 'quiet' || speechRecognized === null) {
    base = 3;  // 발음 스킵
  } else if (speechRecognized) {
    base = 4;  // 정상 학습
  } else {
    base = 2;  // 발음 실패
  }

  // 퀴즈 오답이면 -1
  if (quizCorrect === false) base = Math.max(0, base - 1);

  return base;
}
