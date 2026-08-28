import { describe, it, expect } from 'vitest';
import { MemoryFileIO } from '../src/core/fileio';
import { appendEvents, readLog } from '../src/core/logStore';
import { EventFeed } from '../src/core/feed';

const LOG_PATH = 'activity-atlas.jsonl';

describe('restart continuity', () => {
  it('drains a pending EventFeed on close and resumes seq without loss or duplication on restart', async () => {
    const io = new MemoryFileIO();

    // --- session 1: fresh start, no prior log ---
    const initial = await readLog(io, LOG_PATH);
    expect(initial.maxSeq).toBeNull();
    let feed = new EventFeed(initial.maxSeq ?? 0);
    feed.push('create', 'a.md');
    feed.push('modify', 'a.md');
    feed.push('create', 'b.md');
    // shutdown is requested while events are still queued in memory
    expect(feed.pending).toBe(3);

    // graceful close: drain the feed and append everything before exiting
    await appendEvents(io, LOG_PATH, feed.drain());
    expect(feed.pending).toBe(0);

    // --- session 2: new process starts, reads the log to resume seq ---
    const afterSession1 = await readLog(io, LOG_PATH);
    expect(afterSession1.events.map(e => e.seq)).toEqual([1, 2, 3]);
    expect(afterSession1.minSeq).toBe(1);
    expect(afterSession1.maxSeq).toBe(3);

    feed = new EventFeed(afterSession1.maxSeq ?? 0);
    expect(feed.peekNextSeq()).toBe(4);
    feed.push('modify', 'b.md');
    feed.push('delete', 'a.md');
    expect(feed.pending).toBe(2);

    await appendEvents(io, LOG_PATH, feed.drain());
    expect(feed.pending).toBe(0);

    // --- verify full continuity across the restart: no gaps, no duplicates ---
    const final = await readLog(io, LOG_PATH);
    expect(final.events.map(e => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(final.minSeq).toBe(1);
    expect(final.maxSeq).toBe(5);
    const seqs = final.events.map(e => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('repeated restart cycles keep seq strictly increasing, gap-free and duplicate-free', async () => {
    const io = new MemoryFileIO();
    const cycles = 6;
    const perCycle = 5;
    let lastSeq = 0;

    for (let cycle = 0; cycle < cycles; cycle++) {
      // each cycle simulates a fresh process start reading the log left by the previous one
      const r = await readLog(io, LOG_PATH);
      expect(r.maxSeq ?? 0).toBe(lastSeq);

      const feed = new EventFeed(lastSeq);
      for (let i = 0; i < perCycle; i++) {
        feed.push('modify', `cycle${cycle}-file${i}.md`);
      }
      // close with a still-pending queue, then drain + append before the process exits
      expect(feed.pending).toBe(perCycle);
      await appendEvents(io, LOG_PATH, feed.drain());
      lastSeq = feed.peekNextSeq() - 1;
    }

    const final = await readLog(io, LOG_PATH);
    const seqs = final.events.map(e => e.seq);
    expect(seqs).toEqual(Array.from({ length: cycles * perCycle }, (_, i) => i + 1));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(final.minSeq).toBe(1);
    expect(final.maxSeq).toBe(cycles * perCycle);
  });

  it('events queued but never drained before an unclean exit are absent (not duplicated) after restart', async () => {
    const io = new MemoryFileIO();
    let feed = new EventFeed(0);
    feed.push('create', 'a.md');
    feed.push('create', 'b.md');
    await appendEvents(io, LOG_PATH, feed.drain());

    // second session: events are queued but the process dies before drain+append runs
    feed = new EventFeed((await readLog(io, LOG_PATH)).maxSeq ?? 0);
    feed.push('modify', 'a.md');
    feed.push('modify', 'b.md');
    expect(feed.pending).toBe(2);
    // no drain/append here: unclean exit, queue is lost with the process

    // third session: restart reads only what was durably appended, seq resumes from there
    const afterCrash = await readLog(io, LOG_PATH);
    expect(afterCrash.events.map(e => e.seq)).toEqual([1, 2]);
    expect(afterCrash.maxSeq).toBe(2);

    const freshFeed = new EventFeed(afterCrash.maxSeq ?? 0);
    const e = freshFeed.push('modify', 'a.md');
    // the lost events (seq 3, 4) are gone, not replayed; the new event gets the next free seq
    expect(e.seq).toBe(3);
    await appendEvents(io, LOG_PATH, freshFeed.drain());

    const final = await readLog(io, LOG_PATH);
    const seqs = final.events.map(ev => ev.seq);
    expect(seqs).toEqual([1, 2, 3]);
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});
