-- v1.5: word_images 캐시 테이블 (Unsplash 이미지 TTL 7일 캐싱)
CREATE TABLE IF NOT EXISTS word_images (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  word TEXT UNIQUE NOT NULL,
  image_url TEXT NOT NULL,
  photographer TEXT,
  cached_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE word_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY word_images_select_public ON word_images
  FOR SELECT TO public USING (true);

-- authenticated 사용자 직접 쓰기 금지 (API route의 service_role 경유만 허용)
REVOKE INSERT, UPDATE, DELETE ON word_images FROM authenticated;
