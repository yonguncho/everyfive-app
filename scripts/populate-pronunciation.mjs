/**
 * 무료 Dictionary API로 IPA 가져오고, IPA → 한국어 발음 규칙 변환
 * 사용: node scripts/populate-pronunciation.mjs
 * 비용: 무료 (api.dictionaryapi.dev)
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 환경변수 필요');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// IPA 음소 → 한국어 근사 표기 매핑
const IPA_TO_KO = [
  // 자음
  [/tʃ/g, '치'],  [/dʒ/g, '지'],  [/ŋ/g, 'ㅇ'],
  [/θ/g, '스'],   [/ð/g, '드'],   [/ʃ/g, '쉬'],
  [/ʒ/g, '지'],   [/p/g, 'ㅍ'],   [/b/g, 'ㅂ'],
  [/t/g, 'ㅌ'],   [/d/g, 'ㄷ'],   [/k/g, 'ㅋ'],
  [/g/g, 'ㄱ'],   [/f/g, 'ㅍ'],   [/v/g, 'ㅂ'],
  [/s/g, 'ㅅ'],   [/z/g, 'ㅈ'],   [/h/g, 'ㅎ'],
  [/m/g, 'ㅁ'],   [/n/g, 'ㄴ'],   [/l/g, 'ㄹ'],
  [/r/g, 'ㄹ'],   [/w/g, '우'],   [/j/g, '이'],
  // 모음
  [/iː/g, '이'],  [/ɪ/g, '이'],   [/eɪ/g, '에이'],
  [/ɛ/g, '에'],   [/æ/g, '애'],   [/ɑː/g, '아'],
  [/ɒ/g, '오'],   [/ɔː/g, '오'],  [/oʊ/g, '오우'],
  [/ʊ/g, '우'],   [/uː/g, '우'],  [/ʌ/g, '어'],
  [/ɜː/g, '어'],  [/ə/g, '어'],   [/aɪ/g, '아이'],
  [/aʊ/g, '아우'],[/ɔɪ/g, '오이'], [/e/g, '에'],
  [/i/g, '이'],   [/u/g, '우'],   [/o/g, '오'],
  [/a/g, '아'],
  // 기호 제거
  [/[ˈˌ.]/g, '-'], [/[-]{2,}/g, '-'], [/^-|-$/g, ''],
];

function ipaToKorean(ipa) {
  if (!ipa) return null;
  // 슬래시/대괄호 제거
  let s = ipa.replace(/[\/\[\]]/g, '').trim();
  for (const [pat, rep] of IPA_TO_KO) {
    s = s.replace(pat, rep);
  }
  // 남은 ASCII 제거
  s = s.replace(/[a-zA-Z]/g, '').replace(/[-]{2,}/g, '-').replace(/^-|-$/g, '');
  return s || null;
}

async function fetchIpa(word) {
  // 단어 첫 단어만 조회 (phrasal verb 대응)
  const lookup = word.split(' ')[0].replace(/_\d+$/, '');
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(lookup)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const phonetics = data[0]?.phonetics ?? [];
    const ipa = phonetics.find(p => p.text)?.text ?? data[0]?.phonetic ?? null;
    return ipa;
  } catch {
    return null;
  }
}

async function main() {
  // IPA가 없는 단어만 처리
  const { data: words, error } = await supabase
    .from('words')
    .select('word_id, word')
    .is('ipa', null)
    .order('word')
    .limit(500); // 500개씩 처리

  if (error || !words) { console.error('fetch error', error); return; }

  console.log(`처리할 단어: ${words.length}개`);

  let updated = 0;
  let failed = 0;

  for (const row of words) {
    const ipa = await fetchIpa(row.word);
    if (!ipa) { failed++; process.stdout.write('✗'); continue; }

    const pronunciation_ko = ipaToKorean(ipa);

    await supabase.from('words').update({ ipa, pronunciation_ko }).eq('word_id', row.word_id);
    updated++;
    process.stdout.write('.');

    // API rate limit 방지
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`\n✅ 완료: ${updated}개 업데이트, ${failed}개 실패`);
}

main().catch(console.error);
