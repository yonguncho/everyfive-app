/**
 * E2E 헬퍼: admin client로 사용자 생성 + password로 직접 sign-in (테스트 안정성)
 *
 * 필수 환경변수 (.env.test 또는 CI secret):
 *   SUPABASE_URL             — 로컬: http://127.0.0.1:54321
 *   SUPABASE_SERVICE_ROLE_KEY — `supabase status` 출력의 service_role key
 *   SUPABASE_ANON_KEY         — `supabase status` 출력의 anon key
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const TEST_PASSWORD = 'TestPassword123!';

if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다 (.env.test 확인)');
if (!ANON_KEY) throw new Error('SUPABASE_ANON_KEY 환경변수가 필요합니다 (.env.test 확인)');

export { SUPABASE_URL, ANON_KEY };

export const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

export async function createTestUser(email: string) {
  // 이미 존재하면 삭제
  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list?.users.find((u: any) => u.email === email);
  if (existing) await admin.auth.admin.deleteUser(existing.id);

  const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ email, password: TEST_PASSWORD, email_confirm: true }),
  });
  if (!resp.ok) throw new Error(`createTestUser failed: ${resp.status} ${await resp.text()}`);
  return resp.json() as Promise<{ id: string; email: string }>;
}

export async function deleteTestUser(email: string) {
  const { data: list } = await admin.auth.admin.listUsers();
  const u = list?.users.find((x: any) => x.email === email);
  if (u) await admin.auth.admin.deleteUser(u.id);
}

export async function signInAsUser(email: string): Promise<{ access_token: string; refresh_token: string; user: any }> {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  if (!resp.ok) throw new Error(`signIn failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

export async function getProfile(userId: string) {
  const { data } = await admin.from('profiles').select('*').eq('id', userId).single();
  return data;
}

export async function getEvents(userId: string) {
  const { data } = await admin.from('events').select('*').eq('user_id', userId);
  return data ?? [];
}

export async function getUserWordState(userId: string) {
  const { data } = await admin.from('user_word_state').select('*').eq('user_id', userId);
  return data ?? [];
}

/** Playwright page에 Supabase 세션 주입 — Supabase JS의 storage 형식 따름 */
export async function injectSession(page: any, session: { access_token: string; refresh_token: string; user: any }) {
  const sessionObj = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user: session.user,
  };
  const cookieValue = 'base64-' + Buffer.from(JSON.stringify(sessionObj)).toString('base64');

  // cookie를 localhost + 127.0.0.1 둘 다 설정 (어느 hostname으로 접근하든 동작)
  await page.context().addCookies([
    {
      name: 'sb-127-auth-token',
      value: cookieValue,
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  // initScript로 localStorage 미리 설정 (페이지 로드 전에)
  const lsValue = JSON.stringify(sessionObj);
  await page.addInitScript(({ key, value }: any) => {
    try { window.localStorage.setItem(key, value); } catch {}
  }, { key: 'sb-127-auth-token', value: lsValue });
}

/** Mailpit API에서 가장 최근 매직 링크 추출 */
export async function getMagicLinkFromMailpit(email: string, sinceMs = 5000): Promise<string> {
  const cutoff = Date.now() - sinceMs;
  for (let i = 0; i < 30; i++) {
    const r = await fetch('http://127.0.0.1:54324/api/v1/messages');
    const data = await r.json();
    const msg = data.messages?.find((m: any) =>
      m.To?.some((t: any) => t.Address === email) && new Date(m.Created).getTime() >= cutoff
    );
    if (msg) {
      const full = await fetch(`http://127.0.0.1:54324/api/v1/message/${msg.ID}`).then((x) => x.json());
      const body = full.Text ?? full.HTML ?? '';
      const m = body.match(/https?:\/\/[^\s"<>]+/g);
      if (m && m.length) {
        return m.find((u: string) => u.includes('token') || u.includes('verify')) ?? m[0];
      }
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`Magic link for ${email} not found in Mailpit`);
}
