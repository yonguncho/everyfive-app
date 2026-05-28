'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface Stats {
  streak: number;
  level: string;
  track: string;
  totalLearned: number;
  recentDays: { date: string; new_words_completed: number; reviews_completed: number }[];
}

export default function ProgressPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const [profileRes, dailyStatsRes, wordStateRes] = await Promise.all([
        supabase.from('profiles').select('current_streak, level, track').eq('id', user.id).single(),
        supabase.from('daily_stats').select('date, new_words_completed, reviews_completed')
          .eq('user_id', user.id).order('date', { ascending: false }).limit(7),
        supabase.from('user_word_state').select('word_id', { count: 'exact', head: true }).eq('user_id', user.id),
      ]);

      setStats({
        streak: profileRes.data?.current_streak ?? 0,
        level: profileRes.data?.level ?? 'A1',
        track: profileRes.data?.track ?? 'daily',
        totalLearned: wordStateRes.count ?? 0,
        recentDays: dailyStatsRes.data ?? [],
      });
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return <div className="py-12 text-center text-gray-400 text-sm">불러오는 중...</div>;
  }
  if (!stats) {
    return <div className="py-12 text-center text-gray-500 text-sm">로그인이 필요합니다.</div>;
  }

  const TRACK_KO = { daily: '일상 영어', academic: '학술 영어' };

  return (
    <div className="space-y-4 py-6">
      <h1 className="text-2xl font-bold">진행도</h1>

      {/* 핵심 지표 3개 */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Streak" value={stats.streak} unit="일" color="text-brand" />
        <StatCard label="레벨" value={stats.level} unit="" color="text-gray-800" />
        <StatCard label="학습 단어" value={stats.totalLearned} unit="개" color="text-gray-800" />
      </div>

      {/* 트랙 */}
      <div className="rounded-2xl bg-white shadow-sm p-4 flex items-center gap-3">
        <span className="text-2xl">🎯</span>
        <div>
          <div className="text-xs text-gray-500">학습 트랙</div>
          <div className="font-semibold">{TRACK_KO[stats.track as keyof typeof TRACK_KO] ?? stats.track}</div>
        </div>
      </div>

      {/* 최근 7일 */}
      {stats.recentDays.length > 0 && (
        <div className="rounded-2xl bg-white shadow-sm p-4">
          <div className="text-sm font-semibold mb-3">최근 활동</div>
          <div className="space-y-2">
            {stats.recentDays.map((d) => (
              <div key={d.date} className="flex items-center justify-between text-sm">
                <span className="text-gray-500">{d.date}</span>
                <span className="font-medium">
                  신규 {d.new_words_completed}개
                  {d.reviews_completed > 0 && ` · 복습 ${d.reviews_completed}개`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <a
        href="/daily"
        className="block w-full rounded-xl bg-brand py-3 text-center text-white font-medium"
      >
        오늘의 학습 시작
      </a>
    </div>
  );
}

function StatCard({ label, value, unit, color }: { label: string; value: number | string; unit: string; color: string }) {
  return (
    <div className="rounded-2xl bg-white shadow-sm p-4 text-center">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
      {unit && <div className="text-xs text-gray-400 mt-0.5">{unit}</div>}
    </div>
  );
}
