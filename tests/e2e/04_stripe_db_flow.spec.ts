/**
 * Stream C — Lemon Squeezy DB-level 검증
 * upsert_subscription_with_guard RPC + idempotency 직접 검증
 * (실제 LS 결제는 별도 staging 테스트)
 */
import { test, expect } from '@playwright/test';
import { createTestUser, deleteTestUser, admin } from './helpers';

const TEST_EMAIL = 'e2e-ls@test.local';

test.describe('Stream C: Lemon Squeezy DB flow', () => {
  let userId: string;

  test.beforeAll(async () => {
    await deleteTestUser(TEST_EMAIL);
    const u = await createTestUser(TEST_EMAIL);
    userId = u.id;
  });
  test.afterAll(async () => { await deleteTestUser(TEST_EMAIL); });

  test('upsert_subscription_with_guard creates new subscription', async () => {
    const { data, error } = await admin.rpc('upsert_subscription_with_guard', {
      p_user_id:              userId,
      p_ls_customer_id:       'cus_ls_test1',
      p_ls_subscription_id:   'sub_ls_test1',
      p_plan:                 'pro_10',
      p_status:               'TRIAL',
      p_current_period_end:   new Date(Date.now() + 30 * 86400_000).toISOString(),
      p_trial_end:            new Date(Date.now() + 7 * 86400_000).toISOString(),
      p_cancel_at_period_end: false,
      p_ls_event_ts:          new Date().toISOString(),
    });
    expect(error).toBeNull();
    expect(data).toBe('OK');

    const { data: sub } = await admin.from('subscriptions').select('*').eq('user_id', userId).single();
    expect(sub?.status).toBe('TRIAL');
    expect(sub?.plan).toBe('pro_10');
  });

  test('Stale event is skipped (ordering guard)', async () => {
    const old = new Date(Date.now() - 86400_000).toISOString();
    const { data } = await admin.rpc('upsert_subscription_with_guard', {
      p_user_id:              userId,
      p_ls_customer_id:       'cus_ls_test1',
      p_ls_subscription_id:   'sub_ls_test1',
      p_plan:                 'pro_10',
      p_status:               'ACTIVE',
      p_current_period_end:   new Date(Date.now() + 30 * 86400_000).toISOString(),
      p_trial_end:            null,
      p_cancel_at_period_end: false,
      p_ls_event_ts:          old,  // stale timestamp
    });
    expect(data).toBe('STALE_SKIPPED');
  });

  test('ACTIVE → TRIAL downgrade blocked', async () => {
    await admin.rpc('upsert_subscription_with_guard', {
      p_user_id:              userId,
      p_ls_customer_id:       'cus_ls_test1',
      p_ls_subscription_id:   'sub_ls_test1',
      p_plan:                 'pro_10',
      p_status:               'ACTIVE',
      p_current_period_end:   new Date(Date.now() + 30 * 86400_000).toISOString(),
      p_trial_end:            null,
      p_cancel_at_period_end: false,
      p_ls_event_ts:          new Date(Date.now() + 1000).toISOString(),
    });

    const { data } = await admin.rpc('upsert_subscription_with_guard', {
      p_user_id:              userId,
      p_ls_customer_id:       'cus_ls_test1',
      p_ls_subscription_id:   'sub_ls_test1',
      p_plan:                 'pro_10',
      p_status:               'TRIAL',
      p_current_period_end:   new Date(Date.now() + 30 * 86400_000).toISOString(),
      p_trial_end:            null,
      p_cancel_at_period_end: false,
      p_ls_event_ts:          new Date(Date.now() + 2000).toISOString(),
    });
    expect(data).toBe('DOWNGRADE_BLOCKED');
  });

  test('cancel_at_period_end → CANCELED_AT_PERIOD_END status', async () => {
    const { data } = await admin.rpc('upsert_subscription_with_guard', {
      p_user_id:              userId,
      p_ls_customer_id:       'cus_ls_test1',
      p_ls_subscription_id:   'sub_ls_test1',
      p_plan:                 'pro_10',
      p_status:               'ACTIVE',
      p_current_period_end:   new Date(Date.now() + 30 * 86400_000).toISOString(),
      p_trial_end:            null,
      p_cancel_at_period_end: true,
      p_ls_event_ts:          new Date(Date.now() + 3000).toISOString(),
    });
    expect(data).toBe('OK');
    const { data: sub } = await admin
      .from('subscriptions')
      .select('status, cancel_at_period_end')
      .eq('user_id', userId)
      .single();
    expect(sub?.status).toBe('CANCELED_AT_PERIOD_END');
    expect(sub?.cancel_at_period_end).toBe(true);
  });

  test('ls_events idempotency: unique event_id', async () => {
    const eventId = 'subscription_created:ls_' + Date.now();
    const r1 = await admin.from('ls_events').insert({
      event_id:   eventId,
      event_type: 'subscription_created',
      created_at: new Date().toISOString(),
      payload:    {},
    });
    expect(r1.error).toBeNull();
    const r2 = await admin.from('ls_events').insert({
      event_id:   eventId,
      event_type: 'subscription_created',
      created_at: new Date().toISOString(),
      payload:    {},
    });
    expect(r2.error).not.toBeNull();
    expect(r2.error?.code).toBe('23505');  // unique violation
  });
});
