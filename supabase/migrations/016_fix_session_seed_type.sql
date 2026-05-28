-- migration 016: session_seed 컬럼 타입 INTEGER → BIGINT
-- WHY: computeSeed()는 FNV-32a XOR 결과를 uint32(0~4,294,967,295)로 반환.
--      PostgreSQL INTEGER는 signed 32-bit(최대 2,147,483,647)이므로 seed ≥ 2^31 인 경우 overflow.
--      Fix B(| 0)로 Edge Function에서 int32로 clamp하더라도,
--      BIGINT로 변경하면 향후 알고리즘 변경 시에도 overflow 위험 없음.
ALTER TABLE daily_queue
  ALTER COLUMN session_seed TYPE BIGINT;
