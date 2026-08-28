import { describe, it, expect } from 'vitest';
import { decideLock, ownsLock, parseLock, LOCK_STALE_MS, type WriterLock } from '../src/core/writerLock';

describe('decideLock', () => {
  const now = 1_800_000_000_000;

  it('无锁 → take', () => {
    expect(decideLock(null, 'me', now)).toBe('take');
  });

  it('锁是我的 → take（无论新旧）', () => {
    expect(decideLock({ deviceId: 'me', ts: now - 1000 }, 'me', now)).toBe('take');
    expect(decideLock({ deviceId: 'me', ts: 0 }, 'me', now)).toBe('take');
  });

  it('别人的锁但已过期 → take', () => {
    expect(decideLock({ deviceId: 'other', ts: now - LOCK_STALE_MS - 1 }, 'me', now)).toBe('take');
  });

  it('别人的锁且新鲜 → standby', () => {
    expect(decideLock({ deviceId: 'other', ts: now }, 'me', now)).toBe('standby');
    expect(decideLock({ deviceId: 'other', ts: now - 1000 }, 'me', now)).toBe('standby');
  });

  it('stale 边界：now - ts 恰好等于 staleMs 仍 standby，超过才 take', () => {
    expect(decideLock({ deviceId: 'other', ts: now - LOCK_STALE_MS }, 'me', now)).toBe('standby');
    expect(decideLock({ deviceId: 'other', ts: now - 5000 }, 'me', now, 5000)).toBe('standby');
    expect(decideLock({ deviceId: 'other', ts: now - 5001 }, 'me', now, 5000)).toBe('take');
  });
});

describe('parseLock', () => {
  it('合法 JSON → WriterLock', () => {
    expect(parseLock(JSON.stringify({ deviceId: 'abc', ts: 123 }))).toEqual({
      deviceId: 'abc',
      ts: 123,
    });
  });

  it('坏 JSON → null', () => {
    expect(parseLock('not json {')).toBeNull();
    expect(parseLock('')).toBeNull();
    expect(parseLock('undefined')).toBeNull();
  });

  it('缺字段或字段类型错 → null', () => {
    expect(parseLock('{}')).toBeNull();
    expect(parseLock(JSON.stringify({ deviceId: 'abc' }))).toBeNull();
    expect(parseLock(JSON.stringify({ ts: 123 }))).toBeNull();
    expect(parseLock(JSON.stringify({ deviceId: 1, ts: 123 }))).toBeNull();
    expect(parseLock(JSON.stringify({ deviceId: 'abc', ts: '123' }))).toBeNull();
  });

  it('非对象 JSON → null', () => {
    expect(parseLock('null')).toBeNull();
    expect(parseLock('[1,2]')).toBeNull();
    expect(parseLock('"str"')).toBeNull();
  });
});

describe('two windows competing for the writer lock', () => {
  const T0 = 1_800_000_000_000;
  const HEARTBEAT_MS = 30_000;

  it('active owner blocks a second window from taking over', () => {
    // Window A acquires the lock when nothing is held yet.
    let lock: WriterLock | null = null;
    expect(decideLock(lock, 'window-A', T0)).toBe('take');
    lock = { deviceId: 'window-A', ts: T0 };

    // Window B checks shortly after; A's lock is fresh -> B must stand by.
    expect(decideLock(lock, 'window-B', T0 + 5_000)).toBe('standby');
    // Standing by never mutates the held lock.
    expect(lock).toEqual({ deviceId: 'window-A', ts: T0 });
  });

  it('heartbeat from the current owner renews ts and keeps ownership, still blocking the rival', () => {
    let lock: WriterLock = { deviceId: 'window-A', ts: T0 };

    const beat1 = T0 + HEARTBEAT_MS;
    expect(decideLock(lock, 'window-A', beat1)).toBe('take');
    lock = { deviceId: 'window-A', ts: beat1 };

    const beat2 = beat1 + HEARTBEAT_MS;
    expect(decideLock(lock, 'window-A', beat2)).toBe('take');
    lock = { deviceId: 'window-A', ts: beat2 };

    const beat3 = beat2 + HEARTBEAT_MS;
    expect(decideLock(lock, 'window-A', beat3)).toBe('take');
    lock = { deviceId: 'window-A', ts: beat3 };

    const beat4 = beat3 + HEARTBEAT_MS;
    expect(decideLock(lock, 'window-A', beat4)).toBe('take');
    lock = { deviceId: 'window-A', ts: beat4 };

    // The original acquisition is now older than the stale window, but the
    // renewed timestamp still forces window-B to stand by.
    expect(beat4 - T0).toBeGreaterThan(LOCK_STALE_MS);
    expect(decideLock(lock, 'window-B', beat4 + 1_000)).toBe('standby');
  });

  it('missed heartbeats let the rival take over once the lock goes stale, reversing ownership', () => {
    const lastHeartbeat = T0;
    const lock: WriterLock = { deviceId: 'window-A', ts: lastHeartbeat };

    // window-A stops heartbeating (crash/close). Right up to the stale boundary B still stands by.
    const justBeforeStale = lastHeartbeat + LOCK_STALE_MS;
    expect(decideLock(lock, 'window-B', justBeforeStale)).toBe('standby');

    // One tick past the stale boundary, window-B may take over.
    const afterStale = lastHeartbeat + LOCK_STALE_MS + 1;
    expect(decideLock(lock, 'window-B', afterStale)).toBe('take');

    // window-B writes its own fresh lock; window-A is now the rival and must stand by.
    const bLock: WriterLock = { deviceId: 'window-B', ts: afterStale };
    expect(decideLock(bLock, 'window-A', afterStale + 1_000)).toBe('standby');
  });
});

describe('ownsLock', () => {
  it('lock held by the queried device -> true', () => {
    expect(ownsLock({ deviceId: 'me', ts: 123 }, 'me')).toBe(true);
  });

  it('lock held by a different device -> false', () => {
    expect(ownsLock({ deviceId: 'other', ts: 123 }, 'me')).toBe(false);
  });

  it('no lock at all -> false', () => {
    expect(ownsLock(null, 'me')).toBe(false);
  });
});
