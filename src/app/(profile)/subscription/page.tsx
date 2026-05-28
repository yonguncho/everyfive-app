'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/client';

interface Sub {
  plan: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

const PLAN_LABELS: Record<string, { name: string; words: number; price: string }> = {
  free:   { name: '무료',      words: 5,  price: '₩0' },
  pro_10: { name: 'Pro 10',   words: 10, price: '₩4,900/월' },
  pro_20: { name: 'Pro 20',   words: 20, price: '₩7,900/월' },
  pro_30: { name: 'Pro 30',   words: 30, price: '₩9,900/월' },
};

const STATUS_KO: Record<string, string> = {
  NONE:                 '구독 없음',
  TRIAL:                '체험 중',
  ACTIVE:               '활성',
  PAST_DUE:             '결제 실패',
  CANCELED_AT_PERIOD_END: '기간 종료 후 취소',
  CANCELED:             '취소됨',
};

function SubscriptionContent() {
  const params = useSearchParams();
  const success = params.get('success') === '1';

  const [sub, setSub] = useState<Sub | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/check-entitlement');
      if (res.ok) setSub(await res.json());
      setLoading(false);
    })();
  }, []);

  async function checkout(plan: string) {
    setCheckoutLoading(plan);
    setError(null);
    try {
      const res = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error === 'already_subscribed' ? '이미 구독 중입니다.' : '결제 오류가 발생했습니다.');
        return;
      }
      window.location.href = data.url;
    } catch {
      setError('네트워크 오류. 다시 시도해 주세요.');
    } finally {
      setCheckoutLoading(null);
    }
  }

  const isActive = sub && ['ACTIVE', 'TRIAL', 'CANCELED_AT_PERIOD_END', 'PAST_DUE'].includes(sub.status);
  const currentPlan = PLAN_LABELS[sub?.plan ?? 'free'];

  return (
    <div className="space-y-4 py-6">
      <h1 className="text-2xl font-bold">플랜</h1>

      {success && (
        <div className="rounded-xl bg-green-50 border border-green-200 p-4 text-green-800 text-sm font-medium">
          결제가 완료되었습니다! 학습을 시작하세요.
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl bg-white shadow-sm p-6 text-center text-gray-400">불러오는 중...</div>
      ) : (
        <div className="rounded-2xl bg-white shadow-sm p-5">
          <div className="text-xs text-gray-500 mb-1">현재 플랜</div>
          <div className="text-xl font-bold">{currentPlan?.name ?? sub?.plan}</div>
          {sub && sub.status !== 'NONE' && (
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                ${sub.status === 'ACTIVE' || sub.status === 'TRIAL' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                {STATUS_KO[sub.status] ?? sub.status}
              </span>
              {sub.current_period_end && (
                <span className="text-xs text-gray-400">
                  {sub.cancel_at_period_end ? '만료일' : '갱신일'}: {sub.current_period_end.slice(0, 10)}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-red-700 text-sm">{error}</div>
      )}

      {!isActive && (
        <>
          <div className="text-sm font-semibold text-gray-700 pt-2">업그레이드</div>
          {(['pro_10', 'pro_20', 'pro_30'] as const).map((plan) => {
            const info = PLAN_LABELS[plan];
            return (
              <button
                key={plan}
                onClick={() => checkout(plan)}
                disabled={!!checkoutLoading}
                className="w-full rounded-2xl bg-white shadow-sm p-5 text-left border-2 border-transparent hover:border-brand transition-colors disabled:opacity-50"
              >
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-bold">{info.name}</div>
                    <div className="text-sm text-gray-500">하루 {info.words}단어</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-brand">{info.price}</div>
                    {checkoutLoading === plan && (
                      <div className="text-xs text-gray-400 mt-0.5">이동 중...</div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
          <p className="text-xs text-center text-gray-400 pb-2">7일 무료 체험 · 언제든 취소 가능</p>
        </>
      )}

      {isActive && sub?.plan !== 'free' && (
        <p className="text-xs text-center text-gray-400 pt-2">
          플랜 변경 또는 취소는 Lemon Squeezy 고객 포털에서 진행해 주세요.
        </p>
      )}
    </div>
  );
}

export default function SubscriptionPage() {
  return (
    <Suspense fallback={<div className="py-12 text-center text-gray-400 text-sm">불러오는 중...</div>}>
      <SubscriptionContent />
    </Suspense>
  );
}
