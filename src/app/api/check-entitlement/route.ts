/**
 * 서버 측 entitlement 재검증 (Architecture v4 Section 8.2)
 * Pro 기능 진입 시 호출 — JWT 1h staleness 우회용
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function GET(req: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll().map((c) => ({ name: c.name, value: c.value })); },
        setAll() {},
      },
    }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('subscriptions')
    .select('plan, status, current_period_end, cancel_at_period_end')
    .eq('user_id', user.id)
    .single();

  if (error || !data) {
    return NextResponse.json({
      plan: 'free',
      status: 'NONE',
      current_period_end: null,
      cancel_at_period_end: false,
    });
  }

  return NextResponse.json(data);
}
