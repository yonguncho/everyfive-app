/**
 * Web Speech API wrapper
 * Architecture v4 FR-04: 발음 인식 + capability detection + degradation
 */
import { SPEECH_SCORE_PERFECT as SCORE_PERFECT, SPEECH_SCORE_GOOD as SCORE_GOOD } from '../constants/speechScore';
export { SCORE_PERFECT, SCORE_GOOD };

export interface RecognitionResult {
  text: string;
  matched: boolean;
  attempts: number;
  durationMs: number;
  confidence?: number;   // SpeechRecognitionResult.confidence (0~1, undefined = 브라우저 미지원)
  score?: number;        // 0~100 발음 점수 (confidence 지원 시에만 설정)
  scoreLabel?: string;   // 피드백 문구 (score 있을 때만 설정)
}

export type RecognitionError =
  | 'unsupported'
  | 'permission_denied'
  | 'no_speech'
  | 'audio_capture'
  | 'network'
  | 'aborted';

export const SCORE_CONFIDENCE_WEIGHT = 70;
export const SCORE_TEXT_WEIGHT = 30;

export function isSupported(): boolean {
  return typeof window !== 'undefined' && (
    'webkitSpeechRecognition' in window || 'SpeechRecognition' in window
  );
}

/** Wagner-Fischer O(n) 공간 Levenshtein 거리 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Levenshtein 유사도 (0.0~1.0)
 * 동일 문자열 → 1.0, 완전 불일치 → 0.0
 */
export function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length, 1);
  return 1 - levenshtein(a, b) / maxLen;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

export interface PronounceScoreResult {
  score: number;
  scoreLabel: string;
}

export function computePronounceScore(
  confidence: number,
  recognized: string,
  expected: string,
): PronounceScoreResult {
  const sim = levenshteinSimilarity(normalize(recognized), normalize(expected));
  const raw = confidence * SCORE_CONFIDENCE_WEIGHT + sim * SCORE_TEXT_WEIGHT;
  const score = Math.min(100, Math.max(0, Math.round(raw)));

  let scoreLabel: string;
  if (score >= SCORE_PERFECT) {
    scoreLabel = '완벽해요! 🎯';
  } else if (score >= SCORE_GOOD) {
    scoreLabel = '거의 다 됐어요 👍';
  } else {
    scoreLabel = '다시 해볼게요 🔄';
  }

  return { score, scoreLabel };
}

interface RecognizerOptions {
  expectedWord: string;
  maxAttempts?: number;
  attemptTimeoutMs?: number;
  lang?: string;
}

export async function recognizeWord(
  opts: RecognizerOptions
): Promise<{ result?: RecognitionResult; error?: RecognitionError }> {
  if (!isSupported()) return { error: 'unsupported' };

  const { expectedWord, maxAttempts = 3, attemptTimeoutMs = 5000, lang = 'en-US' } = opts;
  const SpeechRecognition =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

  const expected = expectedWord.toLowerCase().replace(/[^a-z0-9]/g, '');
  const startedAt = performance.now();
  let attempts = 0;

  for (attempts = 1; attempts <= maxAttempts; attempts++) {
    const attempt = await singleAttempt(SpeechRecognition, lang, attemptTimeoutMs);
    if (attempt.error === 'permission_denied') return { error: 'permission_denied' };
    if (attempt.error === 'aborted') return { error: 'aborted' };
    if (attempt.error === 'audio_capture') return { error: 'audio_capture' };

    if (attempt.text) {
      const normalized = attempt.text.toLowerCase().replace(/[^a-z0-9]/g, '');
      const matched = normalized.includes(expected);

      if (matched) {
        const base: RecognitionResult = {
          text: attempt.text,
          matched: true,
          attempts,
          durationMs: performance.now() - startedAt,
        };

        // confidence 지원 시 점수 계산
        if (attempt.confidence !== undefined) {
          base.confidence = attempt.confidence;
          const { score, scoreLabel } = computePronounceScore(
            attempt.confidence,
            attempt.text,
            expectedWord,
          );
          base.score = score;
          base.scoreLabel = scoreLabel;
        }

        return { result: base };
      }
    }
  }

  return {
    result: {
      text: '',
      matched: false,
      attempts,
      durationMs: performance.now() - startedAt,
    },
  };
}

function singleAttempt(
  SR: any,
  lang: string,
  timeoutMs: number,
): Promise<{ text?: string; confidence?: number; error?: RecognitionError }> {
  return new Promise((resolve) => {
    const r = new SR();
    r.lang = lang;
    r.continuous = false;
    r.interimResults = false;
    r.maxAlternatives = 1;

    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { r.abort(); } catch {}
      resolve({ error: 'no_speech' });
    }, timeoutMs);

    r.onresult = (ev: any) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const text = ev.results[0]?.[0]?.transcript ?? '';
      const confidence: number | undefined = ev.results[0]?.[0]?.confidence;
      resolve({ text, confidence });
    };

    r.onerror = (ev: any) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const code = ev.error as string;
      const mapped: RecognitionError =
        code === 'not-allowed' || code === 'service-not-allowed' ? 'permission_denied'
        : code === 'no-speech' ? 'no_speech'
        : code === 'audio-capture' ? 'audio_capture'
        : code === 'network' ? 'network'
        : 'aborted';
      resolve({ error: mapped });
    };

    r.onend = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ error: 'no_speech' });
    };

    try { r.start(); }
    catch (e) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ error: 'aborted' });
    }
  });
}

/** TTS — 클라이언트 합성, 음성 데이터 저장 X */
export function speak(text: string, lang = 'en-US'): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      resolve();
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 0.9;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}
