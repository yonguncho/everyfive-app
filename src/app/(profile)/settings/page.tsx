'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
const LEVEL_NAMES: Record<string, string> = {
  A1: '입문', A2: '초급', B1: '중급', B2: '중상급', C1: '고급', C2: '최고급',
};
// 해당 레벨에 도달하는 데 필요한 최소 누적 활동일
const LEVEL_MILESTONE_DAYS: Record<string, number | null> = {
  A1: null, A2: 7, B1: 30, B2: 90, C1: 180, C2: 365,
};

function getNextLevel(level: string): string | null {
  const idx = LEVEL_ORDER.indexOf(level as any);
  return idx >= 0 && idx < LEVEL_ORDER.length - 1 ? LEVEL_ORDER[idx + 1] : null;
}

export default function SettingsPage() {
  const router = useRouter();
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<'idle' | 'subscribing' | 'done' | 'error'>('idle');
  const [currentLevel, setCurrentLevel] = useState<string>('A1');
  const [activeDays, setActiveDays] = useState<number>(0);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);

      const [profileRes, dailyRes] = await Promise.allSettled([
        supabase.from('profiles')
          .select('level, reminder_email_enabled, push_subscription')
          .eq('id', user.id)
          .single(),
        supabase.from('daily_stats')
          .select('date')
          .eq('user_id', user.id),
      ]);

      const profile = profileRes.status === 'fulfilled' ? profileRes.value.data : null;
      setEmailEnabled(profile?.reminder_email_enabled ?? false);
      setPushSubscribed(!!profile?.push_subscription);
      setCurrentLevel(profile?.level ?? 'A1');

      if (dailyRes.status === 'fulfilled') {
        const rows = dailyRes.value.data ?? [];
        // daily_stats는 cron rollup이므로 오늘이 미반영일 수 있음
        // 오늘 KST 날짜를 포함해 Set으로 유니크 집계
        const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const dateSet = new Set(rows.map((r: any) => r.date as string));
        dateSet.add(todayKst);
        setActiveDays(dateSet.size);
      }

      setLoading(false);
    })();
  }, []);

  async function toggleEmail(checked: boolean) {
    if (!userId) return;
    setEmailEnabled(checked);
    const supabase = createClient();
    const { error } = await supabase
      .from('profiles')
      .update({ reminder_email_enabled: checked })
      .eq('id', userId);
    if (error) setEmailEnabled(!checked);
  }

  async function handlePushSubscribe() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setPushStatus('error');
      return;
    }
    setPushStatus('subscribing');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setPushStatus('error'); return; }

      const registration = await navigator.serviceWorker.ready;
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
      });

      const res = await fetch('/api/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription }),
      });
      if (!res.ok) throw new Error('subscribe api failed');

      setPushSubscribed(true);
      setPushStatus('done');
    } catch (e) {
      console.error('push subscribe error:', e);
      setPushStatus('error');
    }
  }

  if (loading) {
    return <div className="py-12 text-center text-gray-500 text-sm animate-pulse">로딩 중...</div>;
  }

  const nextLevel = getNextLevel(currentLevel);
  const nextMilestoneDays = nextLevel ? (LEVEL_MILESTONE_DAYS[nextLevel] ?? null) : null;
  const progressToNext = nextMilestoneDays
    ? Math.min(100, Math.round((activeDays / nextMilestoneDays) * 100))
    : 100;

  return (
    <div className="max-w-lg mx-auto py-8 px-4 space-y-8">
      <h1 className="text-2xl font-bold">설정</h1>

      {/* 레벨 관리 */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">레벨 관리</h2>
        <div className="rounded-2xl bg-white shadow-sm p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-gray-500 mb-0.5">현재 레벨</div>
              <div className="text-2xl font-bold text-brand">{currentLevel}</div>
              <div className="text-sm text-gray-500">{LEVEL_NAMES[currentLevel] ?? currentLevel}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-500 mb-0.5">누적 학습일</div>
              <div className="text-2xl font-bold text-gray-800">{activeDays}</div>
              <div className="text-sm text-gray-500">일</div>
            </div>
          </div>

          {/* 다음 레벨 진행 바 */}
          {nextLevel && nextMilestoneDays ? (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-gray-500">
                <span>다음 레벨: {nextLevel} ({LEVEL_NAMES[nextLevel]})</span>
                <span>{activeDays} / {nextMilestoneDays}일</span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-brand transition-all duration-500"
                  style={{ width: `${progressToNext}%` }}
                />
              </div>
              <div className="text-xs text-gray-400">
                {nextMilestoneDays - activeDays > 0
                  ? `${nextMilestoneDays - activeDays}일 더 학습하면 자동 승급됩니다`
                  : '오늘 학습을 완료하면 레벨 업됩니다!'}
              </div>
            </div>
          ) : (
            <div className="text-sm text-brand font-medium">최고 레벨 달성!</div>
          )}

          {/* 레벨 기준 안내 */}
          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer select-none">레벨 승급 기준 보기</summary>
            <div className="mt-2 space-y-1 pl-2 border-l-2 border-gray-100">
              <div>A1 → A2: 7일</div>
              <div>A2 → B1: 30일</div>
              <div>B1 → B2: 90일</div>
              <div>B2 → C1: 180일</div>
              <div>C1 → C2: 365일</div>
            </div>
          </details>

          <button
            onClick={() => router.push('/level-test')}
            className="w-full rounded-xl border border-gray-300 py-2.5 text-sm text-gray-700 font-medium"
          >
            레벨 다시 테스트
          </button>
        </div>
      </section>

      {/* 알림 설정 */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">알림 설정</h2>

        <div className="flex items-center justify-between rounded-xl bg-gray-50 p-4">
          <div>
            <div className="font-medium">이메일 리마인더</div>
            <div className="text-sm text-gray-500">매일 오전 9시 학습 알림 이메일</div>
          </div>
          <input
            type="checkbox"
            checked={emailEnabled}
            onChange={(e) => toggleEmail(e.target.checked)}
            className="h-5 w-5 accent-brand"
            aria-label="이메일 리마인더 활성화"
          />
        </div>

        <div className="flex items-center justify-between rounded-xl bg-gray-50 p-4">
          <div>
            <div className="font-medium">웹 푸시 알림</div>
            <div className="text-sm text-gray-500">브라우저 알림으로 학습 리마인더</div>
          </div>
          {pushSubscribed || pushStatus === 'done' ? (
            <span className="text-sm text-green-600 font-medium">구독 중</span>
          ) : (
            <button
              onClick={handlePushSubscribe}
              disabled={pushStatus === 'subscribing'}
              className="rounded-lg bg-brand px-4 py-2 text-sm text-white font-medium disabled:bg-gray-400"
            >
              {pushStatus === 'subscribing' ? '처리 중...' : pushStatus === 'error' ? '다시 시도' : '구독하기'}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
