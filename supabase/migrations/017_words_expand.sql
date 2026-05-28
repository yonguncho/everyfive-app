-- v1.4: words 테이블 생성 (500+ seed 단어 저장소)
-- seed 데이터는 T-02/T-03에서 Codex 경유 별도 INSERT

CREATE TABLE IF NOT EXISTS words (
  word_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  word TEXT UNIQUE NOT NULL,
  definition_ko TEXT NOT NULL,
  definition_en TEXT,
  example_sentence TEXT,
  difficulty SMALLINT NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  category TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_words_difficulty ON words (difficulty);
CREATE INDEX IF NOT EXISTS idx_words_category ON words (category);

ALTER TABLE words ENABLE ROW LEVEL SECURITY;

CREATE POLICY words_select_public ON words
  FOR SELECT TO public USING (true);

-- authenticated 사용자도 직접 INSERT/UPDATE/DELETE 불가 (service_role 경유만 허용)
REVOKE INSERT, UPDATE, DELETE ON words FROM authenticated;
