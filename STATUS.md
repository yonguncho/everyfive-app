# EveryFive Phase 1.0 — 현재 진행 상황

마지막 업데이트: 2026-05-26

## 완료된 모듈

### A. Supabase Auth
- [x] 마이그레이션 001~008 적용 완료 (원격 Supabase 프로젝트)
- [x] supabase/client.ts (browser)
- [x] supabase/server.ts (Server Components/API)
- [x] middleware.ts (보호 라우트)
- [x] login page (이메일 OTP)
- [x] level-test page
- [x] track-select page
- [ ] 실제 로그인 E2E 테스트 (Playwright)

### B. 콘텐츠 (220개 생성됨)
- [x] everyfive-content repo 구조
- [x] word.schema.json (level/track/options 포함)
- [x] generate.js (Codex bridge)
- [x] validate.js (Ajv)
- [x] 220개 단어 생성 완료 (A1×24, A2×49, B1×75, B2×72 / daily×151, academic×69)
- [x] **everyfive-content CDN 배포 완료** → https://everyfive-content.vercel.app/content/v1/words.json
- [ ] 전체 1,500개 생성 (목표 — A1 academic 배치 생성 중)

### C. Lemon Squeezy
- [x] check-entitlement API route
- [x] create-checkout API route (JSON try/catch + env 검증)
- [x] ls-webhook Edge Function v2 (HMAC-SHA256, idempotency, ordering guard)
- [x] 마이그레이션 006/007 (3개 플랜: pro_10/20/30)
- [x] .env.local 환경변수 완비 (SUPABASE_SERVICE_ROLE_KEY 포함)
- [x] Vercel 환경변수 9개 모두 설정 완료
- [x] Edge Function secrets 등록 확인 (ls-webhook 로그 200 정상)
- [x] 결제 플로우 테스트 19/19 통과
- [ ] LS 대시보드 Webhook URL 등록 확인 — ls-webhook 수신 로그 있음 (400 포함)
- [ ] LS test 결제 → webhook 수신 E2E 확인

### D. Service Worker / Offline
- [x] sw.js (cache 전략 4종)
- [x] offline.html
- [x] manifest.json
- [x] ServiceWorkerRegister 컴포넌트
- [x] IndexedDB schema (Dexie v2 — dropped 필터 버그 수정)
- [x] sync client (배치 + backoff + Web Locks)
- [ ] 오프라인 시나리오 E2E 테스트

### E. 핵심 학습 UI
- [x] daily/page.tsx (CDN 단어 fetch + DB 프로필/구독 조회)
- [x] WordCard.tsx (5단계: meaning→pronunciation→phrasal→scenarios→quiz)
  - [x] 4지 선다 quiz (quiz.options) / 텍스트 입력 fallback
  - [x] 시나리오 context 한국어 매핑
- [x] SM-2 sm2Algorithm.ts (클라이언트)
- [x] sync-events Edge Function v6 (서버 SM-2)
- [x] BottomNav.tsx 공용 네비게이션
- [x] (learn)/layout.tsx + (profile)/layout.tsx
- [x] progress/page.tsx (streak, 레벨, 총 학습 단어, 최근 7일)
- [x] subscription/page.tsx (플랜 조회 + 업그레이드 + 결제 성공 배너)

### F. 배포
- [x] **everyfive-app 프로덕션 배포** → https://everyfive-app.vercel.app
- [x] **everyfive-content CDN 배포** → https://everyfive-content.vercel.app
- [x] Next.js 프로덕션 빌드 통과 (TypeScript clean, 12 페이지)
- [x] Vercel 환경변수 9개 확인 완료

## Codex 리뷰 R1 — 2026-05-26 반영 완료

| 이슈 | 파일 | 상태 |
|------|------|------|
| C2: popPendingBatch dropped 필터 누락 | indexedDb.ts | ✅ 수정 |
| C3: create-checkout JSON try/catch 누락 | create-checkout/route.ts | ✅ 수정 |
| C4: subscriptions RLS 보호 확인 | migration 002 | ✅ 확인 |
| M1: sync-events 일본어 주석 | sync-events/index.ts | ✅ 수정 + v6 재배포 |
| M2: QuizStep correct 중복 계산 | WordCard.tsx | ✅ 수정 |
| 추가: Word 타입 schema 불일치 | WordCard.tsx | ✅ 수정 |
| 추가: 시나리오 context 키 한국어 매핑 | WordCard.tsx | ✅ 수정 |
| 추가: 4지 선다 quiz 지원 | WordCard.tsx | ✅ 추가 |

## 잔여 작업 (Jayden 직접 필요)

1. **LS Webhook URL 등록 확인** — Lemon Squeezy 대시보드에서 아래 URL 등록 여부 확인:
   ```
   https://qftncrkvsergtyhilzwa.supabase.co/functions/v1/ls-webhook
   ```
   이벤트: `subscription_created`, `subscription_updated`, `subscription_cancelled`, `order_created`

2. **실제 결제 테스트** — LS test mode에서 결제 → DB `subscriptions` 테이블 확인

## 자동 처리 예정

- A1 academic 25개 배치 생성 (백그라운드 실행 중)
- 추가 배치 후 everyfive-content 재배포 예정
