/**
 * Dexie.js IndexedDB schema
 * Architecture v4 Section 4.3
 */
import Dexie, { type Table } from 'dexie';

export interface CachedWord {
  word_id: string;
  data: any;  // WordContent (lib/types로 분리 가능)
  version: number;
  cached_at: number;
}

export interface PendingEvent {
  idempotent_id: string;
  event: any;
  retry_count: number;
  last_attempt_at: number;
  status?: 'pending';
}

export interface UserStateCache {
  user_id: string;
  data: any;
}

export interface WordStateCache {
  word_id: string;
  data: any;
}

class EveryFiveDB extends Dexie {
  cached_words!: Table<CachedWord, string>;
  pending_events!: Table<PendingEvent, string>;
  user_state!: Table<UserStateCache, string>;
  user_word_state!: Table<WordStateCache, string>;

  constructor() {
    super('everyfive-db');
    this.version(1).stores({
      cached_words: 'word_id, version, cached_at',
      pending_events: 'idempotent_id, last_attempt_at',
      user_state: 'user_id',
      user_word_state: 'word_id',
    });
    this.version(2).stores({
      pending_events: 'idempotent_id, last_attempt_at, status',
    });
    // v3: A4 fix — status 없는 기존 레코드를 'pending'으로 backfill
    this.version(3).upgrade((tx) => {
      return tx.table('pending_events').toCollection().modify((rec) => {
        if (!rec.status) rec.status = 'pending';
      });
    });
  }
}

let _db: EveryFiveDB | null = null;
export function getDb(): EveryFiveDB {
  if (!_db) _db = new EveryFiveDB();
  return _db;
}

// 헬퍼: pending 이벤트 enqueue/dequeue
export async function enqueueEvent(event: any): Promise<void> {
  const db = getDb();
  await db.pending_events.put({
    idempotent_id: event.idempotent_id,
    event,
    retry_count: 0,
    last_attempt_at: Date.now(),
    status: 'pending',  // A4: status 인덱스에 포함되도록 명시 (undefined면 notEqual 쿼리에서 누락됨)
  });
}

export async function popPendingBatch(max = 50): Promise<PendingEvent[]> {
  const db = getDb();
  return db.pending_events
    .where('status').notEqual('dropped')
    .sortBy('last_attempt_at')
    .then((all) => all.slice(0, max));
}

export async function markEventsAccepted(ids: string[]): Promise<void> {
  const db = getDb();
  await db.pending_events.where('idempotent_id').anyOf(ids).delete();
}

// FR-13 backoff schedule: 1s / 5s / 30s / 5min (literal)
const BACKOFF_LADDER_MS = [1000, 5000, 30_000, 300_000];
const MAX_RETRY = BACKOFF_LADDER_MS.length;

export async function markEventsRetry(ids: string[]): Promise<{ dropped: string[] }> {
  const db = getDb();
  const dropped: string[] = [];
  for (const id of ids) {
    const e = await db.pending_events.get(id);
    if (!e) continue;
    const next = e.retry_count + 1;
    if (next >= MAX_RETRY) {
      // Terminal: DB에서 바로 삭제 (영구 잔류로 인한 DB 비대화 방지)
      await db.pending_events.delete(id);
      dropped.push(id);
    } else {
      const backoff = BACKOFF_LADDER_MS[next - 1] ?? 300_000;
      await db.pending_events.update(id, {
        retry_count: next,
        last_attempt_at: Date.now() + backoff,
      });
    }
  }
  return { dropped };
}

export async function getDroppedEventCount(): Promise<number> {
  // Dropped events are deleted on terminal retry; always returns 0 now.
  return 0;
}
