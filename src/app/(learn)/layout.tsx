import BottomNav from '@/components/shared/BottomNav';

export default function LearnLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="pb-20">{children}</div>
      <BottomNav />
    </>
  );
}
