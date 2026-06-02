'use client';

import Link from 'next/link';

export default function AppHeader() {
  return (
    <header className="sticky top-0 z-40 bg-white border-b border-gray-100">
      <div className="max-w-md mx-auto px-4 h-12 flex items-center">
        <Link href="/daily" className="flex items-baseline gap-0">
          <span className="text-xl font-black tracking-tight text-gray-900">Every</span>
          <span className="text-xl font-black tracking-tight text-brand">Five</span>
        </Link>
      </div>
    </header>
  );
}
