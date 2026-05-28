/**
 * Background sync client
 * Architecture v4 FR-13: 5초 배치, max 50, exponential backoff
 */
import { popPendingBatch, markEventsAccepted, markEventsRetry, enqueueEvent, type PendingEvent } from '@/lib/storage/indexedDb';
import { createClient } from '@/lib/supabase/client';
import { newIdempotentId } from './idempotency';

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

const DEVICE_ID_KEY = 'everyfive_device_id';

function getDeviceId(): string {
  let id = typeof localStorage !== 'undefined' ? localStorage.getItem(DEVICE_ID_KEY) : null;
  if (!id) {
    id = newIdempotentId();
    if (typeof localStorage !== 'undefined') localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export async function trackEvent(opts: {
  user_id: string;
  event_type: 'word_learned' | 'pronunciation_attempt' | 'review_completed' | 'session_start' | 'session_end';
  word_id?: string;
  payload?: any;
}): Promise<void> {
  const event = {
    idempotent_id: newIdempotentId(),
    user_id: opts.user_id,
    device_id: getDeviceId(),
    event_type: opts.event_type,
    word_id: opts.word_id,
    payload: opts.payload ?? {},
    client_timestamp: new Date().toISOString(),
  };
  await enqueueEvent(event);
  scheduleSync();
}

export function startSyncLoop(): void {
  if (timer) return;
  timer = setInterval(() => syncNow(), 5000);
}

export function stopSyncLoop(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

function scheduleSync() {
  setTimeout(syncNow, 100);
}

export async function syncNow(): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    // 멀티탭 race 방지: Web Locks API (ifAvailable=true → 다른 탭이 이미 lock 중이면 skip)
    await navigator.locks.request('everyfive-sync', { ifAvailable: true }, async (lock) => {
      if (!lock) return;
      await doSync();
    });
  } else {
    if (inFlight) return;
    inFlight = true;
    try { await doSync(); } finally { inFlight = false; }
  }
}

async function doSync(): Promise<void> {
  let ready: PendingEvent[] = [];
  try {
    const pending = await popPendingBatch(50);
    // Backoff 적용된 항목만 시도
    const now = Date.now();
    ready = pending.filter((e) => e.last_attempt_at <= now);
    if (ready.length === 0) return;

    const supabase = createClient();
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) return;

    let resp: Response;
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10_000);
    try {
      resp = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/sync-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sess.session.access_token}`,
        },
        body: JSON.stringify({
          events: ready.map((p) => p.event),
          device_id: getDeviceId(),
        }),
        signal: ctrl.signal,
      });
    } catch (netErr) {
      // 네트워크 오류 (오프라인 등) 및 AbortError(10s timeout) → 전체 retry mark
      await markEventsRetry(ready.map((e) => e.idempotent_id));
      console.warn('sync network error:', netErr);
      return;
    } finally {
      clearTimeout(tid);
    }

    if (!resp.ok) {
      // A8: HTTP 에러 유형별 분기
      if (resp.status === 401 || resp.status === 403) {
        // 세션 만료 → 재시도 무의미, 다음 auth refresh 후 자연 재시도
        return;
      }
      if (resp.status === 429) {
        // Rate limited → retry with backoff (server may send Retry-After)
        await markEventsRetry(ready.map((e) => e.idempotent_id));
        return;
      }
      if (resp.status >= 400 && resp.status < 500) {
        // Terminal client error (411/413/schema mismatch) → drop from queue.
        // Retrying won't help: same payload → same error.
        await markEventsAccepted(ready.map((e) => e.idempotent_id));
        return;
      }
      // 5xx 서버 오류 → retry
      await markEventsRetry(ready.map((e) => e.idempotent_id));
      return;
    }

    const data = await resp.json();
    if (Array.isArray(data.accepted) && data.accepted.length) await markEventsAccepted(data.accepted);

    if (Array.isArray(data.rejected) && data.rejected.length) {
      // duplicate/invalid/stale → 큐에서 제거 (재시도 무의미)
      const drop = data.rejected
        .filter((r: any) => ['duplicate', 'invalid', 'stale', 'clock_skew_future'].includes(r.reason))
        .map((r: any) => r.idempotent_id);
      if (drop.length) await markEventsAccepted(drop);

      // lock_busy → retry with backoff
      const retry = data.rejected
        .filter((r: any) => r.reason === 'lock_busy')
        .map((r: any) => r.idempotent_id);
      if (retry.length) await markEventsRetry(retry);
    }
  } catch (err) {
    console.warn('sync failed unexpectedly:', err);
    if (ready.length > 0) {
      await markEventsRetry(ready.map((e) => e.idempotent_id));
    }
  }
}
