'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function TrackSelectPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function selectTrack(track: 'daily' | 'academic') {
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) {
        setError('로그인이 만료되었습니다. 다시 로그인해 주세요.');
        setSaving(false);
        return;
      }
      const { error: updErr } = await supabase
        .from('profiles')
        .update({ track })
        .eq('id', user.id);
      if (updErr) {
        setError('트랙 저장 실패. 다시 시도해 주세요.');
        setSaving(false);
        return;
      }
      router.push('/daily');
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? '저장 중 오류');
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 py-12">
      <h1 className="text-2xl font-bold">학습 트랙 선택</h1>
      <p className="text-gray-700 text-sm">언제든 설정에서 변경 가능합니다.</p>

      <button
        onClick={() => selectTrack('daily')}
        disabled={saving}
        className="w-full rounded-xl border border-gray-300 bg-white p-6 text-left disabled:opacity-50"
      >
        <div className="font-bold text-lg mb-1">일상 영어</div>
        <div className="text-sm text-gray-600">회의·식사·이메일 — 실생활 표현</div>
      </button>

      <button
        onClick={() => selectTrack('academic')}
        disabled={saving}
        className="w-full rounded-xl border border-gray-300 bg-white p-6 text-left disabled:opacity-50"
      >
        <div className="font-bold text-lg mb-1">학술 영어</div>
        <div className="text-sm text-gray-600">논문·발표·연구 — Oxford 5000 + CEFR</div>
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
