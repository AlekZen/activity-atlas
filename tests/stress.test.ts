import { afterAll, describe, expect, it } from 'vitest';
import { summarizeActivityDays } from '../src/core/calendar';
import { EventFeed } from '../src/core/feed';
import { parseLog, serializeEvent } from '../src/core/logStore';
import { buildTimeline } from '../src/core/timeline';
import type { ChangeEvent, ChangeOp } from '../src/core/types';

const PROFILE = process.env.VAULT_PULSE_PROFILE === '1';
const BURST_WINDOW_MS = 10 * 60_000;
const BASE_TS = new Date(2026, 7, 28, 12).getTime();
const SIZES = [100, 1_000, 10_000, 50_000] as const;
const OPERATIONS: ChangeOp[] = ['modify', 'modify', 'modify', 'create', 'rename', 'delete'];

interface ProfileRow {
  events: number;
  ingestMs: number;
  timelineMs: number;
  calendarMs: number;
  serializeMs: number;
  parseMs: number;
  heapDeltaMb: number;
}

const profileRows: ProfileRow[] = [];

function createEvents(count: number): ChangeEvent[] {
  return Array.from({ length: count }, (_, index) => {
    const op = OPERATIONS[index % OPERATIONS.length];
    const path = `stress/folder-${index % 40}/file-${index}.md`;
    return {
      seq: index + 1,
      ts: BASE_TS + index * 10,
      op,
      path,
      ...(op === 'rename' ? { oldPath: `${path}.old` } : {}),
      stat: { added: 1, removed: op === 'modify' ? 1 : 0 },
      source: 'live',
    };
  });
}

function elapsed(started: number): number {
  return Number((performance.now() - started).toFixed(3));
}

describe.sequential('high-volume activity', () => {
  for (const count of SIZES) {
    it(`processes ${count.toLocaleString('en-US')} events as one burst`, () => {
      const events = createEvents(count);
      const heapBefore = process.memoryUsage().heapUsed;

      let started = performance.now();
      const feed = new EventFeed(0);
      for (const event of events) {
        feed.push(event.op, event.path, {
          ts: event.ts,
          oldPath: event.oldPath,
          stat: event.stat,
          source: event.source,
        });
      }
      const ingestMs = elapsed(started);

      started = performance.now();
      const timeline = buildTimeline(events, BURST_WINDOW_MS);
      const timelineMs = elapsed(started);

      started = performance.now();
      const days = summarizeActivityDays(events);
      const calendarMs = elapsed(started);

      started = performance.now();
      const serialized = events.map(serializeEvent).join('\n') + '\n';
      const serializeMs = elapsed(started);

      started = performance.now();
      const parsed = parseLog(serialized);
      const parseMs = elapsed(started);

      const heapDeltaMb = Number(((process.memoryUsage().heapUsed - heapBefore) / 1_048_576).toFixed(2));
      profileRows.push({ events: count, ingestMs, timelineMs, calendarMs, serializeMs, parseMs, heapDeltaMb });

      expect(feed.pending).toBe(count);
      expect(parsed.events).toHaveLength(count);
      expect(days).toHaveLength(1);
      expect(timeline).toHaveLength(1);
      expect(timeline[0]).toMatchObject({
        kind: 'burst',
        eventCount: count,
        fileCount: count,
      });
      if (timeline[0].kind === 'burst') expect(timeline[0].changes).toHaveLength(count);
    }, 15_000);
  }

  afterAll(() => {
    if (PROFILE) console.table(profileRows);
  });
});
