-- EveryFive RLS Policies
-- Architecture v4 Section 4.2

-- profiles: own row only
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_select ON profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY profiles_update ON profiles FOR UPDATE USING (id = auth.uid());

-- user_word_state: own rows SELECT only (INSERT/UPDATE는 service_role)
ALTER TABLE user_word_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY uws_select ON user_word_state FOR SELECT USING (user_id = auth.uid());

-- events: INSERT own only, SELECT 차단 (service_role만 audit)
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
CREATE POLICY events_insert ON events FOR INSERT WITH CHECK (user_id = auth.uid());

-- daily_stats: own SELECT
ALTER TABLE daily_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY daily_stats_select ON daily_stats FOR SELECT USING (user_id = auth.uid());

-- daily_queue + daily_queue_items: own SELECT, item UPDATE
ALTER TABLE daily_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY dq_select ON daily_queue FOR SELECT USING (user_id = auth.uid());

ALTER TABLE daily_queue_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY dqi_select ON daily_queue_items FOR SELECT USING (user_id = auth.uid());
CREATE POLICY dqi_update_complete ON daily_queue_items FOR UPDATE USING (user_id = auth.uid());

-- subscriptions: own SELECT only (Stripe webhook이 write)
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY subs_select ON subscriptions FOR SELECT USING (user_id = auth.uid());

-- stripe_events: 전체 차단 (service_role only)
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
-- (정책 없음 = 클라이언트 접근 불가)

-- reports: INSERT own, SELECT 차단 (운영자만 service_role)
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY reports_insert ON reports FOR INSERT WITH CHECK (user_id = auth.uid());

-- config: public SELECT (콘텐츠 버전 조회용)
ALTER TABLE config ENABLE ROW LEVEL SECURITY;
CREATE POLICY config_public_read ON config FOR SELECT USING (true);

-- push_subscriptions: own UPSERT/SELECT
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY push_select ON push_subscriptions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY push_insert ON push_subscriptions FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY push_update ON push_subscriptions FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY push_delete ON push_subscriptions FOR DELETE USING (user_id = auth.uid());
