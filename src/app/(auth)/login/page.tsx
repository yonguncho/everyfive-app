'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
      setSent(true);
    } catch (e: any) {
      setError(e.message ?? '오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: otp.trim(),
        type: 'email',
      });
      if (error) throw error;
      router.push('/level-test');
    } catch (e: any) {
      setError(e.message ?? '코드가 일치하지 않습니다');
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <form onSubmit={verifyOtp} className="space-y-4 py-12">
        <h1 className="text-2xl font-bold">이메일 코드 입력</h1>
        <p className="text-gray-600 text-sm">{email}로 보낸 6자리 코드를 입력해주세요</p>

        <input
          type="text"
          required
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
          placeholder="000000"
          className="w-full rounded-xl border border-gray-300 px-4 py-3 text-3xl text-center tracking-widest font-mono"
          autoFocus
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading || otp.length !== 6}
          className="block w-full rounded-xl bg-brand py-4 text-white font-medium disabled:bg-gray-400"
        >
          {loading ? '확인 중...' : '확인'}
        </button>

        <button type="button" onClick={() => { setSent(false); setOtp(''); }} className="block w-full text-sm text-gray-500 underline">
          다른 이메일로 다시 받기
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={sendOtp} className="space-y-4 py-12">
      <h1 className="text-2xl font-bold">로그인</h1>
      <p className="text-gray-600 text-sm">이메일에 6자리 코드를 보내드립니다 (비밀번호 없음)</p>

      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="your@email.com"
        autoComplete="email"
        inputMode="email"
        className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base"
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading || !email}
        className="block w-full rounded-xl bg-brand py-4 text-white font-medium disabled:bg-gray-400"
      >
        {loading ? '전송 중...' : '6자리 코드 받기'}
      </button>
    </form>
  );
}
