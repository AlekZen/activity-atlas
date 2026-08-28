import { ChangeEvent, ChangeOp, EventSource, LineStat } from './types';

export interface CoalescedChange {
  op: ChangeOp;
  path: string;
  oldPath?: string;
  firstTs: number;
  lastTs: number;
  count: number;
  stat: LineStat | null;
  source: EventSource;
}

export interface ActivityBurst {
  kind: 'burst';
  id: string;
  startTs: number;
  endTs: number;
  fileCount: number;
  eventCount: number;
  changes: CoalescedChange[];
}

export type TimelineItem = ActivityBurst;

function addStats(left: LineStat | null, right: LineStat | null): LineStat | null {
  if (left === null || right === null) return null;
  return { added: left.added + right.added, removed: left.removed + right.removed };
}

function coalesce(events: ChangeEvent[]): CoalescedChange[] {
  const changes: CoalescedChange[] = [];
  const latestModifyByPath = new Map<string, number>();

  for (const event of events) {
    if (event.op === 'modify') {
      const existingIndex = latestModifyByPath.get(event.path);
      if (existingIndex !== undefined) {
        const existing = changes[existingIndex];
        existing.lastTs = Math.max(existing.lastTs, event.ts);
        existing.firstTs = Math.min(existing.firstTs, event.ts);
        existing.count += 1;
        existing.stat = addStats(existing.stat, event.stat);
        existing.source = event.source;
        continue;
      }
    }

    const next: CoalescedChange = {
      op: event.op,
      path: event.path,
      ...(event.oldPath !== undefined ? { oldPath: event.oldPath } : {}),
      firstTs: event.ts,
      lastTs: event.ts,
      count: 1,
      stat: event.stat,
      source: event.source,
    };
    changes.push(next);
    if (event.op === 'modify') latestModifyByPath.set(event.path, changes.length - 1);
  }

  return changes.sort((a, b) => b.lastTs - a.lastTs);
}

function calendarDayId(timestamp: number): number {
  const date = new Date(timestamp);
  return date.getFullYear() * 10_000 + (date.getMonth() + 1) * 100 + date.getDate();
}

function makeBurst(events: ChangeEvent[]): ActivityBurst {
  let startTs = events[0].ts;
  let endTs = events[0].ts;
  const paths = new Set<string>();
  for (const event of events) {
    startTs = Math.min(startTs, event.ts);
    endTs = Math.max(endTs, event.ts);
    if (event.path) paths.add(event.path);
  }
  return {
    kind: 'burst',
    id: `burst-${events[0].seq}-${events[events.length - 1].seq}`,
    startTs,
    endTs,
    fileCount: paths.size,
    eventCount: events.length,
    changes: coalesce(events),
  };
}

/**
 * Builds a newest-first timeline of activity bursts, grouping same-day events
 * that fall within the inactivity window into a single burst.
 */
export function buildTimeline(events: ChangeEvent[], burstWindowMs: number): TimelineItem[] {
  const ordered = [...events].sort((a, b) => a.ts - b.ts || a.seq - b.seq);
  const windowMs = Math.max(0, burstWindowMs);
  const chronological: TimelineItem[] = [];
  let pending: ChangeEvent[] = [];
  let pendingDay: number | null = null;

  const flush = (): void => {
    if (pending.length === 0) return;
    chronological.push(makeBurst(pending));
    pending = [];
    pendingDay = null;
  };

  for (const event of ordered) {
    const eventDay = calendarDayId(event.ts);
    const previous = pending[pending.length - 1];
    if (previous && (
      event.ts - previous.ts > windowMs
      || pendingDay !== eventDay
    )) flush();
    if (pending.length === 0) pendingDay = eventDay;
    pending.push(event);
  }
  flush();

  return chronological.reverse();
}
