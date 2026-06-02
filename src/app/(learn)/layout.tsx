import BottomNav from '@/components/shared/BottomNav';
import AppHeader from '@/components/shared/AppHeader';

export default function LearnLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <div className="max-w-md mx-auto px-4 pb-24">{children}</div>
      <BottomNav />
    </>
  );
}
