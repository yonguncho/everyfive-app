import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="space-y-6 py-12">
      {/* 텍스트 로고 */}
      <div className="mb-2">
        <span className="text-3xl font-black tracking-tight text-gray-900">Every</span><span className="text-3xl font-black tracking-tight text-brand">Five</span>
      </div>

      <h1 className="text-4xl font-bold leading-tight">
        매일 5단어,<br />
        <span className="text-brand">평생 무료.</span>
      </h1>
      <p className="text-lg text-gray-700">
        입에서 안 나오던 단어가<br />
        자연스럽게 나오기 시작합니다.
      </p>

      <ul className="space-y-3 text-gray-700">
        <li className="flex items-start gap-2">
          <span className="text-brand">✓</span>
          <span>매일 5단어, 7~8분이면 끝</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-brand">✓</span>
          <span>발음 인식 피드백 무료</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-brand">✓</span>
          <span>출퇴근·식사 시간 최적화</span>
        </li>
      </ul>

      <Link
        href="/login"
        className="block w-full rounded-xl bg-brand py-4 text-center text-white font-medium"
      >
        시작하기
      </Link>

      <p className="text-center text-xs text-gray-500">
        v{process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.0'}
      </p>
    </div>
  );
}
