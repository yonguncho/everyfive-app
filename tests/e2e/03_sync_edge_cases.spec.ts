/**
 * sync-events edge cases (FR-13 / Architecture v4 12종 매트릭스의 일부)
 */
import { test, expect } from '@playwright/test';
import { createTestUser, deleteTestUser, signInAsUser, SUPABASE_URL } from './helpers';

const TEST_EMAIL = 'e2e-sync@test.local';

test.describe('sync-events edge cases', () => {
  let userId: string;
  let token: string;
  const deviceId = 'e2e-device-1';

  test.beforeAll(async () => {
    await deleteTestUser(TEST_EMAIL);
    const user = await createTestUser(TEST_EMAIL);
    userId = user.id;
    const sess = await signInAsUser(TEST_EMAIL);
    token = sess.access_token;
  });

  test.afterAll(async () => { await deleteTestUser(TEST_EMAIL); });

  async function postSync(events: any[]) {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/sync-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ events, device_id: deviceId }),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }

  test('happy path: 1 event accepted', async () => {
    const ev = {
      idempotent_id: crypto.randomUUID(),
      user_id: userId,
      device_id: deviceId,
      event_type: 'word_learned',
      word_id: crypto.randomUUID(),
      payload: { quality: 4, mode: 'focused' },
      client_timestamp: new Date().toISOString(),
    };
    const r = await postSync([ev]);
    expect(r.status).toBe(200);
    expect(r.body.accepted).toContain(ev.idempotent_id);
  });

  test('duplicate idempotent_id rejected', async () => {
    const id = crypto.randomUUID();
    const ev = {
      idempotent_id: id,
      user_id: userId,
      device_id: deviceId,
      event_type: 'session_start',
      payload: { mode: 'focused' },
      client_timestamp: new Date().toISOString(),
    };
    await postSync([ev]);
    const r2 = await postSync([ev]);
    expect(r2.status).toBe(200);
    expect(r2.body.rejected.some((x: any) => x.reason === 'duplicate')).toBe(true);
  });

  test('future timestamp (>24h) rejected as clock_skew_future', async () => {
    const ev = {
      idempotent_id: crypto.randomUUID(),
      user_id: userId,
      device_id: deviceId,
      event_type: 'session_start',
      payload: {},
      client_timestamp: new Date(Date.now() + 25 * 3600 * 1000).toISOString(),
    };
    const r = await postSync([ev]);
    expect(r.body.rejected.some((x: any) => x.reason === 'clock_skew_future')).toBe(true);
  });

  test('stale (>7 days) rejected', async () => {
    const ev = {
      idempotent_id: crypto.randomUUID(),
      user_id: userId,
      device_id: deviceId,
      event_type: 'session_start',
      payload: {},
      client_timestamp: new Date(Date.now() - 8 * 86400_000).toISOString(),
    };
    const r = await postSync([ev]);
    expect(r.body.rejected.some((x: any) => x.reason === 'stale')).toBe(true);
  });

  test('batch over 50 → 400', async () => {
    const events = Array.from({ length: 51 }, (_, i) => ({
      idempotent_id: crypto.randomUUID(),
      user_id: userId,
      device_id: deviceId,
      event_type: 'session_start',
      payload: { i },
      client_timestamp: new Date().toISOString(),
    }));
    const r = await postSync(events);
    expect(r.status).toBe(400);
  });

  test('partial accept: 1 valid + 1 future', async () => {
    const valid = {
      idempotent_id: crypto.randomUUID(),
      user_id: userId, device_id: deviceId,
      event_type: 'session_start', payload: {},
      client_timestamp: new Date().toISOString(),
    };
    const future = {
      idempotent_id: crypto.randomUUID(),
      user_id: userId, device_id: deviceId,
      event_type: 'session_start', payload: {},
      client_timestamp: new Date(Date.now() + 30 * 3600_000).toISOString(),
    };
    const r = await postSync([valid, future]);
    expect(r.body.accepted).toContain(valid.idempotent_id);
    expect(r.body.rejected.some((x: any) => x.idempotent_id === future.idempotent_id)).toBe(true);
  });
});
