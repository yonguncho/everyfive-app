'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

interface Badge {
  badge_id: string;
  name: string;
  icon: string;
  earned_at: string;
}

interface Stats {
  streak: number;
  level: string;
  track: string;
  totalLearned: number;
  recentDays: { date: string; new_words_completed: number; reviews_completed: number }[];
  upcomingReviews: { date: string; count: number }[];
  earnedBadges: Badge[];
}

export default function ProgressPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const now = new Date();
      const sevenDaysLater = new Date(now);
      sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

      const [profileRes, dailyStatsRes, wordStateRes, upcomingRes, badgesRes] = await Promise.allSettled([
        supabase.from('profiles').select('current_streak, level, track').eq('id', user.id).single(),
        supabase.from('daily_stats').select('date, new_words_completed, reviews_completed')
          .eq('user_id', user.id).order('date', { ascending: false }).limit(7),
        supabase.from('user_word_state').select('word_id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('user_word_state').select('next_due_at')
          .eq('user_id', user.id)
          .gte('next_due_at', now.toISOString())
          .lte('next_due_at', sevenDaysLater.toISOString()),
        supabase.from('user_badges')
          .select('badge_id, earned_at, badges(name, icon)')
          .eq('user_id', user.id)
          .order('earned_at', { ascending: false }),
      ]);

      const profileData = profileRes.status === 'fulfilled' ? profileRes.value.data : null;
      const dailyStatsData = dailyStatsRes.status === 'fulfilled' ? dailyStatsRes.value.data : null;
      const wordStateData = wordStateRes.status === 'fulfilled' ? wordStateRes.value : null;
      const upcomingData = upcomingRes.status === 'fulfilled' ? upcomingRes.value.data : null;
      const badgesData = badgesRes.status === 'fulfilled' ? badgesRes.value.data : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const earnedBadges: Badge[] = (badgesData ?? []).map((b: any) => ({
        badge_id: b.badge_id,
        name: b.badges?.name ?? b.badge_id,
        icon: b.badges?.icon ?? '🏆',
        earned_at: b.earned_at,
      }));

      // next_due_at을 KST 날짜(YYYY-MM-DD)로 그룹화
      const countByDate: Record<string, number> = {};
      for (const row of (upcomingData ?? [])) {
        const kstDate = new Date(row.next_due_at);
        // UTC+9 보정
        kstDate.setHours(kstDate.getHours() + 9);
        const key = kstDate.toISOString().slice(0, 10);
        countByDate[key] = (countByDate[key] ?? 0) + 1;
      }
      const upcomingReviews = Object.entries(countByDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count }));

      setStats({
        streak: profileData?.current_streak ?? 0,
        level: profileData?.level ?? 'A1',
        track: profileData?.track ?? 'daily',
        totalLearned: wordStateData?.count ?? 0,
        recentDays: dailyStatsData ?? [],
        upcomingReviews,
        earnedBadges,
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

      {/* 최근 7일 — 바 차트 */}
      {stats.recentDays.length > 0 && (
        <div className="rounded-2xl bg-white shadow-sm p-4">
          <div className="text-sm font-semibold mb-3">최근 활동</div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={[...stats.recentDays].reverse()} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v, name) => [v, name === 'new_words_completed' ? '신규' : '복습']} />
              <Bar dataKey="new_words_completed" fill="#6366f1" radius={[3,3,0,0]} name="신규" />
              <Bar dataKey="reviews_completed" fill="#a5b4fc" radius={[3,3,0,0]} name="복습" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* SM-2 복습 일정 — 라인 차트 */}
      {stats.upcomingReviews.length > 0 && (
        <div className="rounded-2xl bg-white shadow-sm p-4">
          <div className="text-sm font-semibold mb-3">복습 예정</div>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={stats.upcomingReviews} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v) => [String(v) + '개', '복습']} />
              <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 획득 배지 */}
      {stats.earnedBadges.length > 0 && (
        <div className="rounded-2xl bg-white shadow-sm p-4">
          <div className="text-sm font-semibold mb-3">획득 배지</div>
          <div className="flex flex-wrap gap-3">
            {stats.earnedBadges.map((b) => (
              <div key={b.badge_id} className="flex flex-col items-center gap-1 w-16">
                <span className="text-3xl">{b.icon}</span>
                <span className="text-xs text-gray-600 text-center leading-tight">{b.name}</span>
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
