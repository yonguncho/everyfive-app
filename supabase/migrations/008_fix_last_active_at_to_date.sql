-- last_active_at를 date 타입으로 변경 (KST 날짜 비교 단순화)
-- timestamp with time zone → date (UTC 기준 캐스팅, 기존 데이터 없으므로 무손실)
ALTER TABLE profiles
  ALTER COLUMN last_active_at TYPE date
  USING last_active_at::date;
