# EveryFive Phase 1.0 — E2E 테스트 매트릭스

PRD/Architecture v4 기준 12종 시나리오 + 추가 베타 테스트.

## Critical Path (반드시 통과)

| # | 시나리오 | 자동/수동 | 통과 기준 |
|---|----------|-----------|----------|
| 1 | Signup → Level test → Track → 5단어 학습 → Streak +1 | 수동 | profiles.current_streak = 1, daily_stats row 생성 |
| 2 | 중복 idempotent_id 제출 | Playwright | 200 OK + rejected.reason=duplicate |
| 3 | 미래 timestamp (now+25h) | Playwright | 400 또는 rejected.reason=clock_skew_future |
| 4 | 7일 이상 stale event | Playwright | 400 또는 rejected.reason=stale |
| 5 | 두 브라우저 동시 학습 (multi-context) | Playwright | 둘 다 events append, 시간순 user_word_state |
| 6 | Offline 모드 → 학습 → 온라인 sync | 수동 | pending_events 큐 누적, 복귀 후 비워짐 |
| 7 | SW 캐시 버전 bump (APP_VERSION 변경) | 수동 | 새 SW activated, controllerchange reload |
| 8 | Dexie schema 마이그레이션 v1 → v2 | 수동 | 기존 cached_words 보존, schema 적용 |
| 9 | 마이크 권한 mid-session 거부 | 수동 | no_pronunciation flag, 다음 카드 자동 |
| 10 | Tab backgrounding (시각 변경) | 수동 | recognition pause, 복귀 시 카드 reset |
| 11 | Lemon Squeezy webhook 중복 (event_id 같음) | Lemon Squeezy CLI | 200 OK + 'Duplicate event ignored' |
| 12 | Lemon Squeezy webhook out-of-order | Lemon Squeezy CLI | upsert_subscription_with_guard 'STALE_SKIPPED' |

## Beta 시나리오 (스트림별)

### Stream A — Auth
- [ ] 신규 가입 (이메일 OTP, Mailpit magic link)
- [ ] 같은 이메일 재로그인 → profiles row 1개만 유지
- [ ] middleware 보호: 비로그인 /daily 접속 시 /login redirect
- [ ] Level test 60초 타임아웃 → 미답 = 오답 + 결과 표시
- [ ] Level test 결과 → profiles.level UPDATE 확인 (Studio)
- [ ] Track 선택 → profiles.track UPDATE 확인

### Stream B — 콘텐츠
- [ ] 50단어 샘플 검증: Ajv schema 통과 + 자연스러움 5점 평균 4점 이상
- [ ] 전체 1,500단어 생성 (백그라운드, 약 5시간)
- [ ] 학술 750개 전수 검토 (Claude + Codex 자연스러움)
- [ ] 사용자 in-app 신고 → reports 테이블 INSERT + 24h 내 PR

### Stream C — Lemon Squeezy
- [ ] LS 대시보드에서 Variant ID 4종 생성 (pro_10/15/20/30)
- [ ] Checkout Session 생성 → URL redirect
- [ ] LS test 결제 → success_url 도달
- [ ] webhook 수신: subscription_created → upsert 'OK'
- [ ] 중복 webhook → 'Duplicate event ignored'
- [ ] 같은 사용자 두 번째 checkout 시도 → 409 already_subscribed
- [ ] Cancel → subscription_cancelled → CANCELED_AT_PERIOD_END
- [ ] check-entitlement API 응답 정합

### Stream D — Offline
- [ ] SW 등록 확인 (Application 탭)
- [ ] 오프라인 모드 + 새로고침 → offline.html 폴백
- [ ] 오프라인 학습 → pending_events 누적
- [ ] 온라인 복귀 → 5초 내 자동 sync → 큐 비워짐
- [ ] sync 실패 시 exponential backoff (1s/5s/30s/5min)
- [ ] IndexedDB 4 테이블 존재 + 데이터 정상

## 수동 베타 환경

- Production preview: `http://localhost:3000` (현재 실행 중)
- Supabase Studio: `http://127.0.0.1:54323`
- Mailpit: `http://127.0.0.1:54324`

## 사용자 베타 단계 (Phase 1.3)

- 50명 모집 (Pro 6개월 무료)
- 1주 데이터 수집 (사용자당 50발화)
- 3명 freelance rater (Krippendorff α ≥ 0.7)
- Spearman 계층별 ≥ 0.7
