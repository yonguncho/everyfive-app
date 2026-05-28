"""
daily_queue Edge Function 단위 테스트 (Python mock)
PRD QA 매트릭스 8개 시나리오 검증

※ 실제 Edge Function을 직접 호출하지 않고 함수 로직을 Python으로 재구현하여 검증.
  각 테스트는 독립적 mock DB 상태를 사용한다.
"""
import pytest
import json
import re
import hashlib
import time
from unittest.mock import MagicMock, AsyncMock, patch

# ── FNV-32a Python 구현 (index.ts와 동일 로직) ──────────────────────────────

def fnv32a(s: str) -> int:
    h = 0x811c9dc5
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def compute_seed(user_id: str, date: str) -> int:
    # | 0 equivalent: signed int32 (matches TypeScript | 0 operator)
    v = (fnv32a(user_id) ^ fnv32a(date)) & 0xFFFFFFFF
    return v if v < 0x80000000 else v - 0x100000000


def mulberry32(seed: int):
    s = seed & 0xFFFFFFFF
    def _rng():
        nonlocal s
        s = (s + 0x6d2b79f5) & 0xFFFFFFFF
        t = ((s ^ (s >> 15)) * (1 | s)) & 0xFFFFFFFF
        t = (t + ((t ^ (t >> 7)) * (61 | t)) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return _rng


def fisher_yates(arr: list, seed: int) -> list:
    rng = mulberry32(seed)
    result = list(arr)
    for i in range(len(result) - 1, 0, -1):
        j = int(rng() * (i + 1))
        result[i], result[j] = result[j], result[i]
    return result


DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
MAX_BODY_BYTES = 2048
QUEUE_SIZE = 5
SAMPLE_WORD_IDS = [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000005',
]


# ── 핵심 로직 Python 재구현 (테스트 대상) ────────────────────────────────────

def simulate_daily_queue(
    user_id: str | None,
    content_length: int | None,
    body: dict | None,
    db_cached: dict | None,
    db_due_ids: list[str],
    db_learned_ids: list[str],
    db_upsert_error: Exception | None = None,
    db_due_error: Exception | None = None,
) -> dict:
    """
    Edge Function 핵심 로직 시뮬레이터.
    반환값: {'status': int, 'body': dict | str}
    """
    # Content-Length guard: absent → 411, 초과 → 413 (HTTP 표준)
    if content_length is None:
        return {'status': 411, 'body': {'error': 'content_length_required'}}
    if content_length > MAX_BODY_BYTES:
        return {'status': 413, 'body': {'error': 'payload_too_large'}}

    # JWT 인증
    if user_id is None:
        return {'status': 401, 'body': 'Unauthorized'}

    # target_date 파싱
    target_date_raw = (body or {}).get('target_date')
    if target_date_raw is not None:
        if not isinstance(target_date_raw, str) or not DATE_RE.match(target_date_raw):
            return {'status': 400, 'body': {'error': 'invalid_date_format'}}
        target_date = target_date_raw
    else:
        from datetime import datetime, timezone
        target_date = datetime.now(timezone.utc).strftime('%Y-%m-%d')

    # 캐시 SELECT (placeholder row: word_ids=[] 또는 session_seed=0 → cache miss 취급)
    is_placeholder = db_cached and (
        not isinstance(db_cached.get('word_ids'), list) or
        len(db_cached.get('word_ids', [])) == 0 or
        db_cached.get('session_seed') == 0
    )
    if db_cached and not is_placeholder:
        return {
            'status': 200,
            'body': {
                'word_ids': db_cached['word_ids'],
                'session_seed': db_cached['session_seed'],
                'generated_at': db_cached['generated_at'],
            },
        }

    # due SELECT 오류 시 500
    if db_due_error:
        return {'status': 500, 'body': {'error': 'internal_error'}}

    # word_ids 조립
    word_ids = list(db_due_ids[:QUEUE_SIZE])
    if len(word_ids) < QUEUE_SIZE:
        supplement = [w for w in db_learned_ids if w not in word_ids]
        word_ids += supplement[:QUEUE_SIZE - len(word_ids)]
    if len(word_ids) < QUEUE_SIZE:
        used = set(word_ids)
        for sid in SAMPLE_WORD_IDS:
            if len(word_ids) >= QUEUE_SIZE:
                break
            if sid not in used:
                word_ids.append(sid)
    word_ids = word_ids[:QUEUE_SIZE]

    seed = compute_seed(user_id, target_date)
    shuffled = fisher_yates(word_ids, seed)

    if db_upsert_error:
        return {'status': 500, 'body': {'error': 'internal_error'}}

    return {
        'status': 200,
        'body': {
            'word_ids': shuffled,
            'session_seed': seed,
            'generated_at': 'mocked',
        },
    }


# ── 테스트 케이스 ─────────────────────────────────────────────────────────────

USER_ID = '11111111-1111-1111-1111-111111111111'
TODAY = '2026-05-28'


def test_1_normal_jwt_today_returns_5_word_ids():
    """정상 JWT + today → 5 word_ids 200"""
    result = simulate_daily_queue(
        user_id=USER_ID,
        content_length=2,
        body=None,
        db_cached=None,
        db_due_ids=[],
        db_learned_ids=[],
    )
    assert result['status'] == 200
    body = result['body']
    assert isinstance(body['word_ids'], list)
    assert len(body['word_ids']) == 5
    assert isinstance(body['session_seed'], int)


def test_2_cache_hit_returns_same_word_ids():
    """캐시 HIT → 동일 word_ids + session_seed 반환"""
    cached_seed = compute_seed(USER_ID, TODAY)
    cached_ids = SAMPLE_WORD_IDS[:]
    cached = {
        'word_ids': cached_ids,
        'session_seed': cached_seed,
        'generated_at': '2026-05-28T03:00:00.000Z',
    }
    result = simulate_daily_queue(
        user_id=USER_ID,
        content_length=25,
        body={'target_date': TODAY},
        db_cached=cached,
        db_due_ids=[],
        db_learned_ids=[],
    )
    assert result['status'] == 200
    assert result['body']['word_ids'] == cached_ids
    assert result['body']['session_seed'] == cached_seed


def test_3_no_jwt_returns_401():
    """JWT 없음 → 401"""
    result = simulate_daily_queue(
        user_id=None,
        content_length=2,
        body=None,
        db_cached=None,
        db_due_ids=[],
        db_learned_ids=[],
    )
    assert result['status'] == 401


def test_4a_content_length_absent_returns_411():
    """Content-Length 헤더 없음 → 411 Length Required"""
    result = simulate_daily_queue(
        user_id=USER_ID,
        content_length=None,
        body=None,
        db_cached=None,
        db_due_ids=[],
        db_learned_ids=[],
    )
    assert result['status'] == 411
    assert result['body']['error'] == 'content_length_required'


def test_4b_seed_is_signed_int32():
    """computeSeed 결과가 signed int32 범위(-2^31 ~ 2^31-1) 내에 있음"""
    import itertools
    test_cases = [
        ('user-a', '2026-05-28'),
        ('user-b', '2026-01-01'),
        ('ffffffff-ffff-ffff-ffff-ffffffffffff', '9999-12-31'),
    ]
    for uid, date in test_cases:
        seed = compute_seed(uid, date)
        assert -(2**31) <= seed < 2**31, f"seed {seed} out of int32 range for ({uid}, {date})"


def test_4_content_length_3000_returns_413():
    """Content-Length 3000 → 413"""
    result = simulate_daily_queue(
        user_id=USER_ID,
        content_length=3000,
        body=None,
        db_cached=None,
        db_due_ids=[],
        db_learned_ids=[],
    )
    assert result['status'] == 413
    assert result['body']['error'] == 'payload_too_large'


def test_5_db_error_returns_500_no_stack():
    """DB 오류 → 500 { error: 'internal_error' }, e.message 없음"""
    result = simulate_daily_queue(
        user_id=USER_ID,
        content_length=2,
        body=None,
        db_cached=None,
        db_due_ids=[],
        db_learned_ids=[],
        db_due_error=RuntimeError('connection refused'),
    )
    assert result['status'] == 500
    body = result['body']
    assert body['error'] == 'internal_error'
    # e.message 미노출 검증
    assert 'connection refused' not in json.dumps(body)
    assert 'stack' not in json.dumps(body)


def test_6_invalid_date_format_returns_400():
    """target_date = '20260528' → 400"""
    result = simulate_daily_queue(
        user_id=USER_ID,
        content_length=20,
        body={'target_date': '20260528'},
        db_cached=None,
        db_due_ids=[],
        db_learned_ids=[],
    )
    assert result['status'] == 400
    assert result['body']['error'] == 'invalid_date_format'


def test_7_due_2_supplement_3_total_5():
    """due 2개 + 신규 3개 보충 → 총 5개"""
    due_ids = [
        '22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333',
    ]
    learned_ids = [
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
    ]
    result = simulate_daily_queue(
        user_id=USER_ID,
        content_length=25,
        body={'target_date': TODAY},
        db_cached=None,
        db_due_ids=due_ids,
        db_learned_ids=learned_ids,
    )
    assert result['status'] == 200
    assert len(result['body']['word_ids']) == 5
    # due_ids 2개가 포함되어 있어야 함
    returned = set(result['body']['word_ids'])
    assert returned.issuperset(set(due_ids))


def test_8_empty_user_word_state_sample_fallback():
    """user_word_state 비어있음 → SAMPLE_WORD_IDS fallback으로 5개 반환"""
    result = simulate_daily_queue(
        user_id=USER_ID,
        content_length=2,
        body=None,
        db_cached=None,
        db_due_ids=[],
        db_learned_ids=[],
    )
    assert result['status'] == 200
    word_ids = result['body']['word_ids']
    assert len(word_ids) == 5
    # 모두 SAMPLE_WORD_IDS 에서 온 것이어야 함
    for wid in word_ids:
        assert wid in SAMPLE_WORD_IDS


def test_9_cron_placeholder_cache_miss():
    """cron placeholder row(word_ids=[], session_seed=0) → cache miss 취급, 실제 큐 생성"""
    placeholder = {'word_ids': [], 'session_seed': 0, 'generated_at': '2026-05-28T03:00:00Z'}
    result = simulate_daily_queue(
        user_id=USER_ID,
        content_length=25,
        body={'target_date': TODAY},
        db_cached=placeholder,
        db_due_ids=[],
        db_learned_ids=[],
    )
    assert result['status'] == 200
    # SAMPLE fallback으로 5개 반환 (실제 큐 생성됨)
    assert len(result['body']['word_ids']) == 5
    # session_seed가 0이 아닌 실제 계산값
    assert result['body']['session_seed'] != 0


def test_determinism_same_user_date():
    """동일 user_id + date → 동일 seed, 동일 word_ids"""
    kwargs = dict(
        user_id=USER_ID,
        content_length=25,
        body={'target_date': TODAY},
        db_cached=None,
        db_due_ids=[],
        db_learned_ids=[],
    )
    r1 = simulate_daily_queue(**kwargs)
    r2 = simulate_daily_queue(**kwargs)
    assert r1['body']['word_ids'] == r2['body']['word_ids']
    assert r1['body']['session_seed'] == r2['body']['session_seed']
