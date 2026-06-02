import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const reqUrl = new URL(request.url);
  const { searchParams } = reqUrl;
  // 환경변수 우선 — request.url은 리버스 프록시 뒤에서 내부 URL이 노출될 수 있음
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? reqUrl.origin;
  const code = searchParams.get('code');
  // Sanitize `next` to prevent open redirect / URL confusion attacks.
  // Blocks: `@evil.com` → `https://app.com@evil.com/`, `//evil.com`, `https://evil.com`
  const raw = searchParams.get('next') ?? '/';
  const next = (raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('@') && !raw.includes('://'))
    ? raw
    : '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
