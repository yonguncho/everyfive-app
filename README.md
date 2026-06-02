# EveryFive App (Phase 1.0 MVP)

매일 5단어 영어 학습 PWA — Next.js 15 + Supabase + Web Speech API.

## 현재 상태 (v1.2 — 프로덕션 배포 완료)

🌐 **라이브**: https://everyfive-app.vercel.app

### 구현됨
- ✅ 프로젝트 골격 (Next.js 15 App Router + Tailwind + TS)
- ✅ Supabase 마이그레이션 001~013 (스키마, RLS, 결제, 보안 강화)
- ✅ Web Speech API wrapper (capability detection + degradation)
- ✅ SRS SM-2 알고리즘 (snapshot-first + quality 매핑, quality-3 interval 검증)
- ✅ idempotent UUID 유틸
- ✅ 화면: 랜딩 → 로그인 → 레벨 테스트 → 트랙 선택 → 일일 학습 → 진행도 → 구독
- ✅ WordCard 80초 사이클 (뜻 → 발음 → 구동사 → 시나리오 → 퀴즈)
- ✅ 조용한/집중 모드 토글 + 시간대 자동 추천
- ✅ PWA manifest + CSP 헤더
- ✅ `npm install` 동작 확인 완료
- ✅ Supabase 프로젝트 + 마이그레이션 001~013 원격 적용 완료
- ✅ 환경변수 설정 완료 (Vercel 9개 + 로컬 `.env.local`)
- ✅ sync-events Edge Function v6 (배치 + advisory lock + SM-2 서버 처리)
- ✅ ls-webhook Edge Function v2 (HMAC-SHA256, 결제 플로우 19/19 통과)
- ✅ Lemon Squeezy 결제 통합 (TRIAL/ACTIVE/CANCELED 플로우)
- ✅ Service Worker + IndexedDB prefetch (Dexie v2, backoff + Web Locks)
- ✅ Streak 시스템 (DB 서버 처리)
- ✅ 단어 콘텐츠 500개 (A1~C1, daily/academic 트랙)
- ✅ 프로덕션 배포 (Vercel, TypeScript clean, 12 페이지)

### v1.3 이후 계획 (Out-of-scope for v1.2)
- daily_queue Edge Function (PL/pgSQL) — v1.3 예정
- 콘텐츠 1,000개 추가 생성 (현재 500/1,500 — v1.3 배치 예정)
- E2E 테스트 12종 (Playwright) — 매트릭스 작성 완료, staging 환경 필요
- LS 대시보드 Webhook URL 등록 확인 (수동 운영 작업)

## 로컬 실행

```powershell
cd C:\AI_WORKPLACE\today_product\everyfive-app
copy .env.local.example .env.local
# .env.local에 Supabase URL/Anon Key 입력
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`.

**참고**: Supabase 미설정 상태에서도 랜딩/레벨 테스트 UI는 동작 (로그인은 fail).

## 폴더 구조

```
src/
├── app/                    # Next.js App Router
│   ├── (auth)/login        # 이메일 OTP
│   ├── (onboarding)/       # 레벨 테스트 / 트랙 선택
│   ├── (learn)/daily       # 오늘의 5단어
│   └── (profile)/progress  # streak, 레벨
├── components/learning/    # WordCard 등
├── lib/
│   ├── speech/             # Web Speech wrapper
│   ├── srs/                # SM-2 알고리즘
│   ├── sync/               # idempotency
│   └── supabase/           # client
supabase/
└── migrations/             # 001 schema, 002 RLS
```

## 기반 문서

- `state/today_idea.txt` v4 (Phase 0 APPROVED)
- `state/prd_v1.md` v4.1 (Phase 1 APPROVED)
- `state/architecture.md` v4 (Phase 2 APPROVED)
