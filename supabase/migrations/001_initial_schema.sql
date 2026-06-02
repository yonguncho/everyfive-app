-- EveryFive v0.1.0 Initial Schema
-- Architecture v4 Section 4 기반

-- ============================================
-- profiles (auth.users와 1:1, RLS 보호)
-- ============================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  level TEXT CHECK (level IN ('A1','A2','B1','B2','C1','C2')) DEFAULT 'A1',
  track TEXT CHECK (track IN ('daily','academic')) DEFAULT 'daily',
  current_streak INT DEFAULT 0,
  last_active_at TIMESTAMPTZ,
  last_level_test_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- auth.users 가입 시 profiles 자동 생성
CREATE FUNCTION handle_new_user() RETURNS trigger AS $$
BEGIN
  INSERT INTO profiles(id) VALUES (NEW.id);
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================
-- user_word_state (SRS snapshot, 영구)
-- ============================================
CREATE TABLE user_word_state (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  word_id UUID NOT NULL,
  last_review_at TIMESTAMPTZ,
  next_due_at TIMESTAMPTZ,
  interval_seconds INT DEFAULT 3600,  -- 1h = 3600
  ease_factor REAL DEFAULT 2.5,
  lapse_count INT DEFAULT 0,
  best_recognition_rate REAL,
  best_pronunciation_score REAL,
  mode_history JSONB DEFAULT '{}',
  flags TEXT[] DEFAULT '{}',
  PRIMARY KEY (user_id, word_id)
);
CREATE INDEX idx_uws_due ON user_word_state(user_id, next_due_at);

-- ============================================
-- events (append-only, 30일 audit window, dual date)
-- ============================================
CREATE TABLE events (
  idempotent_id UUID PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  device_id TEXT,
  event_type TEXT CHECK (event_type IN (
    'word_learned','pronunciation_attempt','review_completed',
    'session_start','session_end'
  )),
  word_id UUID,
  payload JSONB,
  client_timestamp TIMESTAMPTZ,
  server_received_at TIMESTAMPTZ DEFAULT NOW(),
  -- sync-events Edge Function이 INSERT 전 계산 (skew check + fallback)
  effective_activity_date_kst DATE NOT NULL,
  -- audit/TTL용 (GENERATED ALWAYS, 항상 신뢰)
  server_received_date_kst DATE GENERATED ALWAYS AS (
    (server_received_at AT TIME ZONE 'Asia/Seoul')::DATE
  ) STORED
);
CREATE INDEX idx_events_user_effective_date ON events(user_id, effective_activity_date_kst);
CREATE INDEX idx_events_user_server_date ON events(user_id, server_received_date_kst);
CREATE INDEX idx_events_word_replay ON events(user_id, word_id, server_received_at);

-- 중복 완료 방지 (effective 기준)
CREATE UNIQUE INDEX idx_daily_completion ON events(user_id, word_id, effective_activity_date_kst)
  WHERE event_type = 'word_learned';

-- ============================================
-- daily_stats (무기한 rollup)
-- ============================================
CREATE TABLE daily_stats (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  new_words_completed INT DEFAULT 0,
  reviews_completed INT DEFAULT 0,
  focused_sessions INT DEFAULT 0,
  quiet_sessions INT DEFAULT 0,
  sessions_with_speech INT DEFAULT 0,
  avg_recognition_rate REAL,
  total_time_seconds INT,
  PRIMARY KEY (user_id, date)
);

-- ============================================
-- daily_queue + daily_queue_items (정규화)
-- ============================================
CREATE TABLE daily_queue (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE,
  new_count INT,
  review_count INT,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, date)
);

CREATE TABLE daily_queue_items (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE,
  word_id UUID NOT NULL,
  position INT NOT NULL,
  source TEXT CHECK (source IN (
    'new','review_1h','review_1d','review_3d','review_7d',
    'review_14d','review_30d','review_60d_plus'
  )),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, date, word_id)
);
CREATE INDEX idx_dqi_user_date_pos ON daily_queue_items(user_id, date, position);

-- ============================================
-- subscriptions (Stripe ordering guard 포함)
-- ============================================
CREATE TABLE subscriptions (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan TEXT CHECK (plan IN ('free','pro_10','pro_15','pro_20','pro_30')) DEFAULT 'free',
  status TEXT CHECK (status IN (
    'NONE','TRIAL','ACTIVE','PAST_DUE',
    'CANCELED_AT_PERIOD_END','CANCELED'
  )) DEFAULT 'NONE',
  current_period_end TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  stripe_subscription_updated_at TIMESTAMPTZ,  -- ordering guard
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- stripe_events (idempotency)
-- ============================================
CREATE TABLE stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT,
  created_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  payload JSONB
);

-- ============================================
-- reports (사용자 신고)
-- ============================================
CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  word_id UUID,
  category TEXT CHECK (category IN ('typo','meaning','inappropriate','other')),
  comment TEXT,
  status TEXT CHECK (status IN ('report','triage','fixing','patched')) DEFAULT 'report',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- config (콘텐츠 버전 등 public read)
-- ============================================
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO config(key, value) VALUES ('current_content_version', 'v1');

-- ============================================
-- push_subscriptions (Web Push)
-- ============================================
CREATE TABLE push_subscriptions (
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  device_id TEXT,
  endpoint TEXT,
  p256dh TEXT,
  auth TEXT,
  PRIMARY KEY (user_id, device_id)
);
