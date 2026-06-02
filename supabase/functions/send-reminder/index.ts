// @ts-ignore Deno imports
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
// @ts-ignore Deno imports
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// @ts-ignore Deno globals
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
// @ts-ignore Deno globals
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
// @ts-ignore Deno globals
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// @ts-ignore Deno globals
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;

const BATCH_SIZE = 200;
const RESEND_TIMEOUT_MS = 8000;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200 });
  }

  // pg_cron 외 무단 호출 차단 (verify_jwt=false이므로 CRON_SECRET으로 인증)
  const incomingSecret = req.headers.get('x-cron-secret');
  if (!incomingSecret || incomingSecret !== CRON_SECRET) {
    console.error(JSON.stringify({ event: 'send_reminder_unauthorized' }));
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 이메일 리마인더 활성 사용자 조회 — 배치 페이지네이션 적용
  const allProfiles: any[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await admin
      .from('profiles')
      .select('id, last_active_at')
      .eq('reminder_email_enabled', true)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error(JSON.stringify({ event: 'send_reminder_profiles_failed', error: error.message }));
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
    // 오늘 학습 완료 여부 확인 (last_active_at이 오늘이면 스킵)
    const lastActive = (profile as any).last_active_at;
    if (lastActive && lastActive >= today) continue;

    // service_role Admin API로 이메일 조회
    const { data: authData, error: authErr } = await admin.auth.admin.getUserById((profile as any).id);
    if (authErr || !authData?.user?.email) continue;

    const email = authData.user.email;

    try {
      const startMs = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'reminder@everyfive.app',
            to: email,
            subject: '오늘의 영단어를 학습해보세요!',
            html: '<p>안녕하세요! 오늘의 5단어 학습을 시작해볼까요? <a href="https://everyfive.app/learn/daily">지금 학습하기</a></p>',
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      const durationMs = Date.now() - startMs;

      if (!res.ok) {
        console.error(JSON.stringify({ event: 'send_reminder_email_failed', userId: (profile as any).id, status: res.status, durationMs }));
        failed++;
      } else {
        console.log(JSON.stringify({ event: 'send_reminder_email_sent', userId: (profile as any).id, durationMs }));
        sent++;
      }
    } catch (e) {
      const isTimeout = (e as Error)?.name === 'AbortError';
      console.error(JSON.stringify({ event: 'send_reminder_email_error', userId: (profile as any).id, error: isTimeout ? 'timeout' : (e as Error)?.message }));
      failed++;
    }
  }

  return new Response(JSON.stringify({ sent, failed }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
