import { describe, it, expect } from 'vitest';
import { MemoryFileIO } from '../src/core/fileio';
import { appendEvents, readLog, parseLog, isStale, rotateIfNeeded } from '../src/core/logStore';
import { ChangeEvent } from '../src/core/types';

function ev(seq: number, ts = 1000): ChangeEvent {
  return { seq, ts, op: 'modify', path: `f${seq}.md`, stat: { added: 1, removed: 0 }, source: 'live' };
}

describe('appendEvents + readLog', () => {
  it('creates file then appends, preserving order', async () => {
    const io = new MemoryFileIO();
    await appendEvents(io, 'log.jsonl', [ev(1), ev(2)]);
    await appendEvents(io, 'log.jsonl', [ev(3)]);
    const r = await readLog(io, 'log.jsonl');
    expect(r.events.map(e => e.seq)).toEqual([1, 2, 3]);
    expect(r.minSeq).toBe(1);
    expect(r.maxSeq).toBe(3);
  });

  it('readLog on missing file returns empty', async () => {
    const r = await readLog(new MemoryFileIO(), 'nope.jsonl');
    expect(r).toEqual({ events: [], minSeq: null, maxSeq: null });
  });

  it('appendEvents with empty array is a no-op', async () => {
    const io = new MemoryFileIO();
    await appendEvents(io, 'log.jsonl', []);
    expect(await io.exists('log.jsonl')).toBe(false);
  });
});

describe('parseLog', () => {
  it('skips corrupt lines and blank lines', () => {
    const good = JSON.stringify(ev(5));
    const r = parseLog(`${good}\n{bad json\n\n${JSON.stringify(ev(6))}\n`);
    expect(r.events.map(e => e.seq)).toEqual([5, 6]);
  });

  it('skips semantically corrupt lines (missing op/path)', () => {
    const good = JSON.stringify(ev(6));
    const r = parseLog(`{"seq": 5}\n${good}\n`);
    expect(r.events.map(e => e.seq)).toEqual([6]);
    expect(r.maxSeq).toBe(6);
  });

  it('skips a corrupt intermediate line and a truncated final line, keeping valid lines before and after both', () => {
    const lines = [
      JSON.stringify(ev(1)),
      JSON.stringify(ev(2)),
      '{"seq": 3, "op": "modify"', // invalid intermediate: incomplete JSON object, missing path/closing brace
      JSON.stringify(ev(4)),
      JSON.stringify(ev(5)),
      '{"seq": 6, "op": "modify", "path": "f6.md"', // truncated final line: write cut off mid-object, no trailing newline
    ];
    const r = parseLog(lines.join('\n'));
    expect(r.events.map(e => e.seq)).toEqual([1, 2, 4, 5]);
    expect(r.minSeq).toBe(1);
    expect(r.maxSeq).toBe(5);
  });
});

describe('corrupted JSONL recovery via FileIO', () => {
  it('readLog skips a corrupt middle line and a crash-truncated tail written across separate appends', async () => {
    const io = new MemoryFileIO();
    await appendEvents(io, 'log.jsonl', [ev(1), ev(2)]);
    // a prior process wrote a semantically-broken line with trailing garbage (e.g. partial overwrite)
    await io.append('log.jsonl', '{"seq": 3, "op": "modify"}extra-garbage\n');
    await appendEvents(io, 'log.jsonl', [ev(4), ev(5)]);
    // the current process crashes mid-write: partial JSON, no closing brace, no trailing newline
    await io.append('log.jsonl', '{"seq": 6, "op": "modify", "path"');

    const r = await readLog(io, 'log.jsonl');
    expect(r.events.map(e => e.seq)).toEqual([1, 2, 4, 5]);
    expect(r.minSeq).toBe(1);
    expect(r.maxSeq).toBe(5);
  });
});

describe('isStale', () => {
  it('new reader (cursor 0) is never stale', () => {
    expect(isStale(10, 0)).toBe(false);
  });
  it('contiguous log (minSeq == cursor+1) is not stale', () => {
    expect(isStale(101, 100)).toBe(false);
  });
  it('gap after rotation is stale', () => {
    expect(isStale(105, 100)).toBe(true);
  });
  it('empty log is not stale', () => {
    expect(isStale(null, 100)).toBe(false);
  });
});

describe('rotateIfNeeded', () => {
  it('truncates by maxEntries, keeping newest', async () => {
    const io = new MemoryFileIO();
    await appendEvents(io, 'log.jsonl', [ev(1), ev(2), ev(3), ev(4), ev(5)]);
    const rotated = await rotateIfNeeded(io, 'log.jsonl', 3, 90, 2000);
    expect(rotated).toBe(true);
    const r = await readLog(io, 'log.jsonl');
    expect(r.events.map(e => e.seq)).toEqual([3, 4, 5]);
  });

  it('truncates by age', async () => {
    const io = new MemoryFileIO();
    await appendEvents(io, 'log.jsonl', [ev(1, 1000), ev(2, 5000)]);
    const dayMs = 86400000;
    const rotated = await rotateIfNeeded(io, 'log.jsonl', 100, 1, 1000 + dayMs + 1);
    expect(rotated).toBe(true);
    const r = await readLog(io, 'log.jsonl');
    expect(r.events.map(e => e.seq)).toEqual([2]);
  });

  it('no-op when within limits', async () => {
    const io = new MemoryFileIO();
    await appendEvents(io, 'log.jsonl', [ev(1), ev(2)]);
    expect(await rotateIfNeeded(io, 'log.jsonl', 100, 90, 2000)).toBe(false);
  });

  it('rotates 50,000 entries to exactly the limit, keeping only the most recent contiguous sequences', async () => {
    const io = new MemoryFileIO();
    const total = 50_010;
    const limit = 50_000;
    const events = Array.from({ length: total }, (_, i) => ev(i + 1));
    await appendEvents(io, 'log.jsonl', events);

    const started = performance.now();
    const rotated = await rotateIfNeeded(io, 'log.jsonl', limit, 90, 2000);
    if (process.env.VAULT_PULSE_PROFILE === '1') {
      console.log(`rotateIfNeeded(50k): ${(performance.now() - started).toFixed(3)}ms`);
    }

    expect(rotated).toBe(true);
    const r = await readLog(io, 'log.jsonl');
    expect(r.events).toHaveLength(limit);
    expect(r.events.map(e => e.seq)).toEqual(
      Array.from({ length: limit }, (_, i) => total - limit + 1 + i),
    );
    expect(r.minSeq).toBe(total - limit + 1);
    expect(r.maxSeq).toBe(total);
  }, 15_000);
});
