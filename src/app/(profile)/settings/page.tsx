'use client';

import { useEffect, useState } from 'react';
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

export default function SettingsPage() {
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<'idle' | 'subscribing' | 'done' | 'error'>('idle');

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);

      const { data: profile } = await supabase
        .from('profiles')
        .select('reminder_email_enabled, push_subscription')
        .eq('id', user.id)
        .single();

      setEmailEnabled(profile?.reminder_email_enabled ?? false);
      setPushSubscribed(!!profile?.push_subscription);
      setLoading(false);
    })();
  }, []);

  async function toggleEmail(checked: boolean) {
    if (!userId) return;
    setEmailEnabled(checked);
    const supabase = createClient();
    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ reminder_email_enabled: checked })
      .eq('id', userId);
    if (updateErr) {
      console.error('toggleEmail update failed:', updateErr.message);
      setEmailEnabled(!checked);
    }
  }

  async function handlePushSubscribe() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setPushStatus('error');
      return;
    }

    setPushStatus('subscribing');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPushStatus('error');
        return;
      }

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

  return (
    <div className="max-w-lg mx-auto py-8 px-4 space-y-8">
      <h1 className="text-2xl font-bold">설정</h1>

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
