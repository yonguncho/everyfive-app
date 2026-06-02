-- F-CV2-02: profiles 집계 컬럼 직접 UPDATE 차단
-- 사용자가 current_streak / last_active_at 을 임의 값으로 덮어쓰는 것을 방지한다.
-- sync-events Edge Function은 service_role로 실행되므로 영향 없음.
REVOKE UPDATE(current_streak)  ON profiles FROM authenticated;
REVOKE UPDATE(last_active_at)  ON profiles FROM authenticated;

-- F-CV2-03: events 직접 INSERT 차단
-- 클라이언트가 sync-events Edge Function을 우회해 events 테이블에 직접 INSERT하는 것을 방지한다.
-- Edge Function(service_role)만 INSERT 가능하도록 변경.
DROP POLICY IF EXISTS events_insert ON events;
REVOKE INSERT ON events FROM authenticated;
