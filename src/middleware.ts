/**
 * Next.js middleware: 보호 라우트 + 세션 갱신 + CSP nonce
 */
import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

const PROTECTED_PATHS = ['/level-test', '/track-select', '/daily', '/review', '/progress', '/settings', '/subscription'];

function buildCsp(nonce: string): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const localOrigin = supabaseUrl.match(/^https?:\/\/[^/]+/)?.[0] ?? '';
  const isLocal = localOrigin.includes('127.0.0.1') || localOrigin.includes('localhost');
  const localWs = isLocal ? localOrigin.replace('http://', 'ws://').replace('https://', 'wss://') : '';

  const connectSrc = [
    "'self'",
    'https://*.supabase.co',
    'wss://*.supabase.co',
    ...(isLocal && localOrigin ? [localOrigin, localWs] : []),
    'https://api.lemonsqueezy.com',
  ].join(' ');

  // WHY strict-dynamic: allows Next.js to load scripts it injects dynamically at runtime
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "worker-src 'self'",
    `connect-src ${connectSrc}`,
    "frame-src https://app.lemonsqueezy.com",
    "manifest-src 'self'",
  ].join('; ');
}

export async function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');

  // Forward nonce to layout via request header so Next.js App Router can use it
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  // Set CSP on response — unsafe-inline removed; nonce covers Next.js inline hydration scripts
  response.headers.set('Content-Security-Policy', buildCsp(nonce));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll(); },
        setAll(toSet: { name: string; value: string; options?: CookieOptions }[]) {
          toSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const path = req.nextUrl.pathname;

  if (PROTECTED_PATHS.some((p) => path.startsWith(p))) {
    if (!user) {
      const loginUrl = new URL('/login', req.url);
      loginUrl.searchParams.set('next', path);
      return NextResponse.redirect(loginUrl);
    }
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js|offline.html|manifest.json|api/).*)'],
};
