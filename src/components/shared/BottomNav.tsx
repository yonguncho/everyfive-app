'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/daily',        label: '학습',  icon: '📖' },
  { href: '/progress',     label: '진행도', icon: '📊' },
  { href: '/subscription', label: '플랜',  icon: '⭐' },
];

export default function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 safe-bottom">
      <div className="mx-auto max-w-md flex">
        {NAV.map(({ href, label, icon }) => {
          const active = path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex-1 flex flex-col items-center py-3 gap-0.5 text-xs
                ${active ? 'text-brand font-semibold' : 'text-gray-500'}`}
            >
              <span className="text-lg leading-none">{icon}</span>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
