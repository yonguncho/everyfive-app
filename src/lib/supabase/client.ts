/** Supabase client (browser) — Architecture v4 Section 5.2 */
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        // 'pkce': access_token을 URL hash 대신 ?code= 파라미터로 전달.
        // implicit 대비 Referrer 헤더 노출·히스토리 스니핑 위험 제거.
        // 매직 링크도 /auth/callback?code= 경로를 통해 동일하게 처리됨.
        flowType: 'pkce',
        detectSessionInUrl: true,
        autoRefreshToken: true,
        persistSession: true,
      },
    }
  );
}
