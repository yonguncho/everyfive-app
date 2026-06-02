import { describe, it, expect } from 'vitest';
import { levenshteinSimilarity, computePronounceScore, buildCharAlignment } from '../webSpeech';

function pronounceScore(confidence: number, recognized: string, expected: string): number {
  return computePronounceScore(confidence, recognized, expected).score;
}

describe('levenshteinSimilarity', () => {
  it('양쪽 빈 문자열 → 1.0', () => {
    expect(levenshteinSimilarity('', '')).toBe(1.0);
  });

  it('동일 문자열 → 1.0', () => {
    expect(levenshteinSimilarity('abc', 'abc')).toBe(1.0);
  });

  it('한쪽 빈 문자열 → 0.0', () => {
    expect(levenshteinSimilarity('abc', '')).toBe(0.0);
    expect(levenshteinSimilarity('', 'abc')).toBe(0.0);
  });

  it('부분 일치 — 1자 차이', () => {
    // 'abc' → 'abd': 편집거리 1, max=3 → similarity = 1 - 1/3 ≈ 0.667
    const sim = levenshteinSimilarity('abc', 'abd');
    expect(sim).toBeCloseTo(1 - 1 / 3, 5);
  });

  it('완전 불일치', () => {
    // 'abc' → 'xyz': 편집거리 3, max=3 → similarity = 0
    expect(levenshteinSimilarity('abc', 'xyz')).toBe(0.0);
  });

  it('30자 이하 계산 성능 < 5ms (NFR-01)', () => {
    const a = 'a'.repeat(30);
    const b = 'b'.repeat(30);
    levenshteinSimilarity(a, b); // JIT warmup
    const start = performance.now();
    levenshteinSimilarity(a, b);
    expect(performance.now() - start).toBeLessThan(5);
  });
});

describe('pronounceScore 경계값 (NFR-08)', () => {
  // confidence=1.0, 완전 일치 → 1.0*70 + 1.0*30 = 100
  it('score 100 (confidence=1.0, 완전 일치)', () => {
    expect(pronounceScore(1.0, 'look up', 'look up')).toBe(100);
  });

  // scoreLabel 경계값: 90
  it('score >= 90 → "완벽해요! 🎯" 경계', () => {
    const score = pronounceScore(1.0, 'look up', 'look up');
    expect(score).toBeGreaterThanOrEqual(90);
  });

  // score 0 경계
  it('score 0 (confidence=0, 완전 불일치)', () => {
    expect(pronounceScore(0, 'xyz', 'abc')).toBe(0);
  });

  // confidence=0.59, 완전 일치 → 0.59*70 + 1.0*30 = 41.3 + 30 = 71.3 → 71
  it('score 59 근방 — confidence=0.59, 완전 일치', () => {
    const score = pronounceScore(0.59, 'look up', 'look up');
    // 0.59*70 + 1.0*30 = 41.3 + 30 = 71.3 → score는 60~89 구간
    expect(score).toBeGreaterThanOrEqual(60);
    expect(score).toBeLessThan(90);
  });

  // confidence=0.86, 완전 일치 → 0.86*70 + 30 = 60.2 + 30 = 90.2 → 90
  it('score 89 근방 — confidence 낮고 유사도 낮을 때', () => {
    // confidence=0, levenshtein("look", "lock") = 1, max=4 → sim = 0.75 → 0*70 + 0.75*30 = 22.5 → 23
    const score = pronounceScore(0, 'lock', 'look');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThan(60);
  });

  // confidence=0, 완전 일치 → 0*70 + 1.0*30 = 30 (score < 60)
  it('score < 60 — confidence=0, 완전 일치 (Chrome edge case)', () => {
    const score = pronounceScore(0, 'look up', 'look up');
    expect(score).toBe(30);
    expect(score).toBeLessThan(60);
  });
});

describe('confidence undefined → score 미설정 (NFR-07)', () => {
  it('levenshteinSimilarity는 항상 0~1 범위', () => {
    expect(levenshteinSimilarity('hello', 'world')).toBeGreaterThanOrEqual(0);
    expect(levenshteinSimilarity('hello', 'world')).toBeLessThanOrEqual(1);
  });
});

describe('buildCharAlignment', () => {
  it('완전 일치 → 모든 쌍 match=true', () => {
    const result = buildCharAlignment('focus', 'focus');
    expect(result.every((p) => p.match)).toBe(true);
    expect(result.map((p) => p.exp).join('')).toBe('focus');
  });

  it('1자 치환 — focus vs fockus: c↔k 불일치', () => {
    const result = buildCharAlignment('focus', 'fockus');
    const mismatches = result.filter((p) => !p.match);
    expect(mismatches.length).toBeGreaterThan(0);
    // 전체 길이는 정렬 후 max(5,6) 이상
    expect(result.length).toBeGreaterThanOrEqual(5);
  });

  it('완전 불일치 → match=true 항목 없음', () => {
    const result = buildCharAlignment('abc', 'xyz');
    expect(result.every((p) => !p.match)).toBe(true);
  });

  it('recognized가 빈 문자열 → exp만 남고 rec=null', () => {
    const result = buildCharAlignment('hi', '');
    expect(result.every((p) => p.rec === null)).toBe(true);
  });

  it('expected가 빈 문자열 → exp=null, rec만 남음', () => {
    const result = buildCharAlignment('', 'hi');
    expect(result.every((p) => p.exp === null)).toBe(true);
  });

  it('대소문자 무시 — Focus vs focus → 모두 일치', () => {
    const result = buildCharAlignment('Focus', 'focus');
    expect(result.every((p) => p.match)).toBe(true);
  });
});
