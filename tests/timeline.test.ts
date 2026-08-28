import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../src/core/timeline';
import type { ChangeEvent } from '../src/core/types';

function event(seq: number, ts: number, op: ChangeEvent['op'], path: string): ChangeEvent {
  return { seq, ts, op, path, stat: { added: 1, removed: 0 }, source: 'live' };
}

describe('buildTimeline', () => {
  it('separates bursts after the inactivity window', () => {
    const timeline = buildTimeline([
      event(1, 1_000, 'modify', 'a.md'),
      event(2, 2_000, 'modify', 'b.md'),
      event(3, 20_000, 'modify', 'c.md'),
    ], 5_000);
    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({ kind: 'burst', fileCount: 1 });
    expect(timeline[1]).toMatchObject({ kind: 'burst', fileCount: 2 });
  });

  it('keeps adjacent events on different days in separate bursts', () => {
    const beforeMidnight = new Date(2026, 7, 27, 23, 59).getTime();
    const afterMidnight = new Date(2026, 7, 28, 0, 1).getTime();
    const timeline = buildTimeline([
      event(1, beforeMidnight, 'modify', 'a.py'),
      event(2, afterMidnight, 'modify', 'a.py'),
    ], 5 * 60_000);
    expect(timeline).toHaveLength(2);
    expect(timeline.every(item => item.kind === 'burst')).toBe(true);
  });

  it('uses commits as hard burst boundaries', () => {
    const timeline = buildTimeline([
      event(1, 1_000, 'modify', 'a.md'),
      {
        seq: 2,
        ts: 2_000,
        op: 'commit',
        path: '',
        stat: null,
        source: 'git',
        commit: { oid: 'abcdef', shortOid: 'abcdef', subject: 'save', author: 'Alek', ts: 2_000, paths: ['a.md'] },
      },
      event(3, 3_000, 'modify', 'a.md'),
    ], 60_000);
    expect(timeline.map(item => item.kind)).toEqual(['burst', 'commit', 'burst']);
  });

  it('coalesces repeated modifications and sums line statistics', () => {
    const timeline = buildTimeline([
      event(1, 1_000, 'modify', 'a.md'),
      { ...event(2, 2_000, 'modify', 'a.md'), stat: { added: 2, removed: 3 } },
    ], 5_000);
    const burst = timeline[0];
    expect(burst.kind).toBe('burst');
    if (burst.kind !== 'burst') return;
    expect(burst.eventCount).toBe(2);
    expect(burst.changes).toHaveLength(1);
    expect(burst.changes[0]).toMatchObject({ count: 2, stat: { added: 3, removed: 3 } });
  });

  it('preserves lifecycle operations as separate rows', () => {
    const timeline = buildTimeline([
      event(1, 1_000, 'create', 'a.md'),
      event(2, 2_000, 'rename', 'b.md'),
      event(3, 3_000, 'delete', 'b.md'),
    ], 5_000);
    const burst = timeline[0];
    expect(burst.kind).toBe('burst');
    if (burst.kind !== 'burst') return;
    expect(burst.changes.map(change => change.op)).toEqual(['delete', 'rename', 'create']);
  });
});
