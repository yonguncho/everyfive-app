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
  onInterimResult?: (text: string) => void;
}

export async function recognizeWord(
  opts: RecognizerOptions
): Promise<{ result?: RecognitionResult; error?: RecognitionError }> {
  if (!isSupported()) return { error: 'unsupported' };

  const { expectedWord, maxAttempts = 3, attemptTimeoutMs = 5000, lang = 'en-US', onInterimResult } = opts;
  const SpeechRecognition =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

  const expected = expectedWord.toLowerCase().replace(/[^a-z0-9]/g, '');
  const startedAt = performance.now();
  let attempts = 0;
  let lastText = '';
  let lastConfidence: number | undefined;

  for (attempts = 1; attempts <= maxAttempts; attempts++) {
    const attempt = await singleAttempt(SpeechRecognition, lang, attemptTimeoutMs, onInterimResult);
    if (attempt.error === 'permission_denied') return { error: 'permission_denied' };
    if (attempt.error === 'aborted') return { error: 'aborted' };
    if (attempt.error === 'audio_capture') return { error: 'audio_capture' };

    if (attempt.text) {
      lastText = attempt.text;
      lastConfidence = attempt.confidence;
      const normalized = attempt.text.toLowerCase().replace(/[^a-z0-9]/g, '');
      // 1) 완전 포함
      // 2) Levenshtein 유사도 55% 이상
      // 3) 구(phrasal) 단어 부분 매칭: 구성 단어(4자+) 중 하나라도 인식 텍스트에 포함
      const sim = levenshteinSimilarity(normalized, expected);
      const phraseWords = expectedWord.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter(w => w.length >= 4);
      const partialMatch = phraseWords.some(w => normalized.includes(w));
      const matched = normalized.includes(expected) || sim >= 0.55 || partialMatch;

      if (matched) {
        const base: RecognitionResult = {
          text: attempt.text,
          matched: true,
          attempts,
          durationMs: performance.now() - startedAt,
        };

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

  // 불일치 시에도 마지막으로 인식된 발음의 점수를 포함해 피드백 제공
  const failResult: RecognitionResult = {
    text: lastText,
    matched: false,
    attempts,
    durationMs: performance.now() - startedAt,
  };
  if (lastText && lastConfidence !== undefined) {
    failResult.confidence = lastConfidence;
    const { score, scoreLabel } = computePronounceScore(lastConfidence, lastText, expectedWord);
    failResult.score = score;
    failResult.scoreLabel = scoreLabel;
  }
  return { result: failResult };
}

function singleAttempt(
  SR: any,
  lang: string,
  timeoutMs: number,
  onInterim?: (text: string) => void,
): Promise<{ text?: string; confidence?: number; error?: RecognitionError }> {
  return new Promise((resolve) => {
    const r = new SR();
    r.lang = lang;
    r.continuous = false;
    r.interimResults = onInterim !== undefined;
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
      const isFinal = ev.results[0]?.isFinal ?? true;
      const text = ev.results[0]?.[0]?.transcript ?? '';
      if (!isFinal) {
        onInterim?.(text);
        return;
      }
      done = true;
      clearTimeout(timer);
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

/**
 * 두 영단어(expected vs recognized)를 문자 단위로 정렬해 반환.
 * Levenshtein edit path를 역추적해 (exp, rec, match) 쌍을 만든다.
 */
export function buildCharAlignment(
  expected: string,
  recognized: string,
): Array<{ exp: string | null; rec: string | null; match: boolean }> {
  const a = expected.toLowerCase().replace(/[^a-z]/g, '');
  const b = recognized.toLowerCase().replace(/[^a-z]/g, '');
  const m = a.length, n = b.length;

  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
      else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  const result: Array<{ exp: string | null; rec: string | null; match: boolean }> = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ exp: a[i - 1], rec: b[j - 1], match: true });
      i--; j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      result.unshift({ exp: a[i - 1], rec: b[j - 1], match: false });
      i--; j--;
    } else if (j > 0 && dp[i][j] === dp[i][j - 1] + 1) {
      result.unshift({ exp: null, rec: b[j - 1], match: false });
      j--;
    } else {
      result.unshift({ exp: a[i - 1], rec: null, match: false });
      i--;
    }
  }
  return result;
}

const VOICE_PRIORITY = [
  'Google US English',
  'Microsoft Aria Online (Natural)',
  'Microsoft Jenny Online (Natural)',
  'Microsoft Guy Online (Natural)',
  'Microsoft Zira Online (Natural)',
  'Samantha',           // macOS / iOS
  'Alex',               // macOS legacy
  'Microsoft David',
  'Microsoft Zira',
];

function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  for (const name of VOICE_PRIORITY) {
    const v = voices.find((v) => v.name === name);
    if (v) return v;
  }
  return voices.find((v) => v.lang.startsWith(lang.split('-')[0]) && v.lang === lang)
    ?? voices.find((v) => v.lang.startsWith('en'))
    ?? null;
}

function getVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) { resolve(voices); return; }
    const onChanged = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', onChanged);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener('voiceschanged', onChanged);
    setTimeout(() => { window.speechSynthesis.removeEventListener('voiceschanged', onChanged); resolve([]); }, 2000);
  });
}

/** TTS — 클라이언트 합성, 음성 데이터 저장 X */
export function speak(text: string, lang = 'en-US'): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) { resolve(); return; }
    getVoices().then((voices) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = 0.85;
      u.pitch = 1.0;
      const voice = pickVoice(voices, lang);
      if (voice) u.voice = voice;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  });
}
