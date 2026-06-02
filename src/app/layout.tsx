import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import '@/styles/globals.css';
import ServiceWorkerRegister from '@/components/shared/ServiceWorkerRegister';

export const metadata: Metadata = {
  title: 'EveryFive — 매일 5단어',
  description: '매일 5단어로 발음·구동사·상황까지 익히는 영어 학습',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2563eb',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read nonce forwarded by middleware so Next.js applies it to its own inline hydration scripts
  const nonce = (await headers()).get('x-nonce') ?? '';

  return (
    <html lang="ko">
      <head>
        <meta name="app-version" content={process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.0'} />
        {nonce && <meta property="csp-nonce" content={nonce} />}
      </head>
      <body className="font-sans">
        <ServiceWorkerRegister />
        <main className="mx-auto max-w-md min-h-screen px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
