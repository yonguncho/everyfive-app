-- 049_badges_tables.sql
-- badges + user_badges 테이블 (v2.0 배지 시스템)
-- 2026-05-29: 최초 적용 (DB에 직접 MCP apply_migration으로 적용됨)

CREATE TABLE IF NOT EXISTS badges (
  badge_id        TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  icon            TEXT NOT NULL DEFAULT '🏆',
  threshold_type  TEXT NOT NULL CHECK (threshold_type IN ('word_count','streak','category_count')),
  threshold_value INTEGER NOT NULL,
  category_filter TEXT
);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id    UUID      NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  badge_id   TEXT      NOT NULL REFERENCES badges(badge_id) ON DELETE CASCADE,
  earned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, badge_id)
);

-- RLS
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "badges_select_public" ON badges FOR SELECT USING (true);
CREATE POLICY "user_badges_select_own" ON user_badges FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_badges_insert_service" ON user_badges FOR INSERT WITH CHECK (true);

-- 인덱스
CREATE INDEX IF NOT EXISTS user_badges_user_id_idx ON user_badges (user_id);

-- 씨드 데이터
INSERT INTO badges (badge_id, name, description, icon, threshold_type, threshold_value) VALUES
  ('biz_100',    '비즈니스 입문',   '비즈니스 단어 100개 학습',  '💼', 'word_count', 100),
  ('biz_500',    '비즈니스 마스터', '비즈니스 단어 500개 학습',  '🏢', 'word_count', 500),
  ('toeic_1000', 'TOEIC 준비 완료', 'TOEIC 단어 1000개 학습',   '📝', 'word_count', 1000),
  ('words_100',  '첫 100단어',     '누적 100단어 학습',          '⭐', 'word_count', 100),
  ('words_500',  '500단어 달성',   '누적 500단어 학습',          '🌟', 'word_count', 500),
  ('words_1000', '단어 마스터',    '누적 1000단어 학습',         '🎯', 'word_count', 1000),
  ('streak_7',   '7일 연속',       '7일 연속 학습',              '🔥', 'streak', 7),
  ('streak_30',  '한 달 도전',     '30일 연속 학습',             '💪', 'streak', 30)
ON CONFLICT (badge_id) DO NOTHING;
