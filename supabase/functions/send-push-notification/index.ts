// @ts-ignore Deno imports
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
// @ts-ignore Deno imports
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
// @ts-ignore npm import
import webpush from 'npm:web-push';

// @ts-ignore Deno globals
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
// @ts-ignore Deno globals
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
// @ts-ignore Deno globals
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
// @ts-ignore Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// @ts-ignore Deno globals
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;

webpush.setVapidDetails('mailto:admin@everyfive.app', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const BATCH_SIZE = 200;
const WEBPUSH_TIMEOUT_MS = 8000;

/** webpush.sendNotification에 타임아웃 적용 */
async function sendWithTimeout(subscription: object, payload: string): Promise<void> {
  await Promise.race([
    webpush.sendNotification(subscription, payload),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('webpush_timeout')), WEBPUSH_TIMEOUT_MS)
    ),
  ]);
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200 });
  }

  // pg_cron 외 무단 호출 차단 (verify_jwt=false이므로 CRON_SECRET으로 인증)
  const incomingSecret = req.headers.get('x-cron-secret');
  if (!incomingSecret || incomingSecret !== CRON_SECRET) {
    console.error(JSON.stringify({ event: 'send_push_unauthorized' }));
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 푸시 구독 있는 사용자 조회 — 배치 페이지네이션 적용
  const allProfiles: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await admin
      .from('profiles')
      .select('id, push_subscription, last_active_at')
      .not('push_subscription', 'is', null)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error(JSON.stringify({ event: 'send_push_profiles_failed', error: error.message }));
      return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500 });
    }
    if (!data?.length) break;
    allProfiles.push(...data);
    if (data.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  const today = new Date().toISOString().slice(0, 10);
  let sent = 0;
  let failed = 0;

  for (const profile of allProfiles) {
    const lastActive = (profile as any).last_active_at;
    if (lastActive && lastActive >= today) continue;

    const subscription = (profile as any).push_subscription;
    if (!subscription) continue;

    try {
      const startMs = Date.now();
      const parsedSub = typeof subscription === 'string' ? JSON.parse(subscription) : subscription;
      await sendWithTimeout(parsedSub, JSON.stringify({ title: 'everyfive', body: '오늘의 단어 5개를 학습해보세요!' }));
      const durationMs = Date.now() - startMs;
      console.log(JSON.stringify({ event: 'push_notification_sent', userId: (profile as any).id, durationMs }));
      sent++;
    } catch (e) {
      const msg = (e as Error)?.message ?? 'unknown';
      const statusCode = (e as any)?.statusCode ?? (e as any)?.status;
      console.error(JSON.stringify({ event: 'push_notification_failed', userId: (profile as any).id, error: msg }));
      if (statusCode === 410) {
        await admin.from('profiles').update({ push_subscription: null }).eq('id', (profile as any).id);
        console.log(JSON.stringify({ event: 'push_subscription_expired_cleaned', userId: (profile as any).id }));
      }
      failed++;
    }
  }

  // 실패율 80% 초과 시 경고 로그
  const total = sent + failed;
  if (total > 0 && failed / total > 0.8) {
    console.error(JSON.stringify({ event: 'push_high_failure_rate', sent, failed, total }));
  }

  return new Response(JSON.stringify({ sent, failed }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
