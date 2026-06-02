// Edge Function: populate-pronunciation
// 무료 Dictionary API로 IPA 가져와 words 테이블 일괄 업데이트
// POST /functions/v1/populate-pronunciation  (service role key 필요)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const IPA_TO_KO: [RegExp, string][] = [
  [/tʃ/g, '치'], [/dʒ/g, '지'], [/ŋ/g, 'ㅇ'],
  [/θ/g, '스'],  [/ð/g, '드'],  [/ʃ/g, '쉬'],
  [/ʒ/g, '지'],  [/p/g, 'ㅍ'],  [/b/g, 'ㅂ'],
  [/t/g, 'ㅌ'],  [/d/g, 'ㄷ'],  [/k/g, 'ㅋ'],
  [/g/g, 'ㄱ'],  [/f/g, 'ㅍ'],  [/v/g, 'ㅂ'],
  [/s/g, 'ㅅ'],  [/z/g, 'ㅈ'],  [/h/g, 'ㅎ'],
  [/m/g, 'ㅁ'],  [/n/g, 'ㄴ'],  [/l/g, 'ㄹ'],
  [/r/g, 'ㄹ'],  [/w/g, '우'],  [/j/g, '이'],
  [/iː/g, '이'], [/ɪ/g, '이'],  [/eɪ/g, '에이'],
  [/ɛ/g, '에'],  [/æ/g, '애'],  [/ɑː/g, '아'],
  [/ɒ/g, '오'],  [/ɔː/g, '오'], [/oʊ/g, '오우'],
  [/ʊ/g, '우'],  [/uː/g, '우'], [/ʌ/g, '어'],
  [/ɜː/g, '어'], [/ə/g, '어'],  [/aɪ/g, '아이'],
  [/aʊ/g, '아우'],[/ɔɪ/g, '오이'],[/e/g, '에'],
  [/i/g, '이'],  [/u/g, '우'],  [/o/g, '오'],
  [/a/g, '아'],
  [/[ˈˌ.]/g, '-'], [/-{2,}/g, '-'], [/^-|-$/g, ''],
];

function ipaToKorean(ipa: string): string | null {
  let s = ipa.replace(/[\/\[\]]/g, '').trim();
  for (const [pat, rep] of IPA_TO_KO) s = s.replace(pat, rep);
  s = s.replace(/[a-zA-Z]/g, '').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
  return s || null;
}

async function fetchIpa(word: string): Promise<string | null> {
  const lookup = word.split(' ')[0].replace(/_\d+$/, '');
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(lookup)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const phonetics: { text?: string }[] = data[0]?.phonetics ?? [];
    return phonetics.find((p) => p.text)?.text ?? data[0]?.phonetic ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const body = await req.json().catch(() => ({}));
  const batchSize = Number(body.batch_size ?? 50);

  const { data: words, error } = await supabase
    .from('words')
    .select('word_id, word')
    .is('ipa', null)
    .order('word')
    .limit(batchSize);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!words?.length) return new Response(JSON.stringify({ updated: 0, message: '모두 완료' }));

  let updated = 0;
  let failed = 0;

  for (const row of words) {
    const ipa = await fetchIpa(row.word);
    if (!ipa) { failed++; continue; }
    const pronunciation_ko = ipaToKorean(ipa);
    await supabase.from('words').update({ ipa, pronunciation_ko }).eq('word_id', row.word_id);
    updated++;
    await new Promise((r) => setTimeout(r, 100));
  }

  return new Response(JSON.stringify({ updated, failed, remaining: (words.length === batchSize) }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
