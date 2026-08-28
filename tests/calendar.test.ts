import { describe, expect, it } from 'vitest';
import { buildCalendarMonth, localDayKey, navigateCalendarDate, summarizeActivityDays } from '../src/core/calendar';
import type { ChangeEvent } from '../src/core/types';

function event(seq: number, ts: number, path: string): ChangeEvent {
  return { seq, ts, op: 'modify', path, stat: null, source: 'live' };
}

describe('calendar activity model', () => {
  it('aggregates events, unique files, and commit paths by local day', () => {
    const morning = new Date(2026, 7, 28, 9).getTime();
    const afternoon = new Date(2026, 7, 28, 15).getTime();
    const summaries = summarizeActivityDays([
      event(1, morning, 'a.py'),
      event(2, afternoon, 'a.py'),
      event(3, afternoon, 'b.html'),
      {
        seq: 4,
        ts: afternoon,
        op: 'commit',
        path: '',
        stat: null,
        source: 'git',
        commit: {
          oid: 'abcdef',
          shortOid: 'abcdef',
          subject: 'save',
          author: 'Alek',
          ts: afternoon,
          paths: ['b.html', 'c.css'],
        },
      },
    ]);

    expect(summaries.get(localDayKey(morning))).toMatchObject({
      eventCount: 4,
      fileCount: 3,
      commitCount: 1,
    });
  });

  it('builds six Monday-first weeks with adjacent-month context', () => {
    const cells = buildCalendarMonth(2026, 7, new Map());
    expect(cells).toHaveLength(42);
    expect(new Date(cells[0].timestamp).getDay()).toBe(1);
    expect(cells.filter(cell => cell.inCurrentMonth)).toHaveLength(31);
    expect(cells.some(cell => !cell.inCurrentMonth)).toBe(true);
  });

  it('attaches activity only to its matching day cell', () => {
    const timestamp = new Date(2026, 7, 28, 12).getTime();
    const summaries = summarizeActivityDays([event(1, timestamp, 'sample.py')]);
    const cells = buildCalendarMonth(2026, 7, summaries);
    const active = cells.filter(cell => cell.activity !== null);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ key: localDayKey(timestamp), dayNumber: 28 });
  });
});

function noon(year: number, month: number, day: number): number {
  return new Date(year, month, day, 12).getTime();
}

describe('navigateCalendarDate keyboard contract', () => {
  // Wednesday, August 26 2026 — mid-week anchor away from month/year boundaries.
  const base = noon(2026, 7, 26);

  it('moves one day with ArrowRight and ArrowLeft', () => {
    expect(localDayKey(navigateCalendarDate(base, 'ArrowRight')!)).toBe(localDayKey(noon(2026, 7, 27)));
    expect(localDayKey(navigateCalendarDate(base, 'ArrowLeft')!)).toBe(localDayKey(noon(2026, 7, 25)));
  });

  it('moves one week with ArrowDown and ArrowUp', () => {
    expect(localDayKey(navigateCalendarDate(base, 'ArrowDown')!)).toBe(localDayKey(noon(2026, 8, 2)));
    expect(localDayKey(navigateCalendarDate(base, 'ArrowUp')!)).toBe(localDayKey(noon(2026, 7, 19)));
  });

  it('jumps to Monday on Home and Sunday on End within the same week', () => {
    const monday = navigateCalendarDate(base, 'Home');
    const sunday = navigateCalendarDate(base, 'End');
    expect(localDayKey(monday!)).toBe(localDayKey(noon(2026, 7, 24)));
    expect(new Date(monday!).getDay()).toBe(1);
    expect(localDayKey(sunday!)).toBe(localDayKey(noon(2026, 7, 30)));
    expect(new Date(sunday!).getDay()).toBe(0);
  });

  it('moves to the same day in the adjacent month with PageDown and PageUp', () => {
    expect(localDayKey(navigateCalendarDate(base, 'PageDown')!)).toBe(localDayKey(noon(2026, 8, 26)));
    expect(localDayKey(navigateCalendarDate(base, 'PageUp')!)).toBe(localDayKey(noon(2026, 6, 26)));
  });

  it('clamps PageDown into a shorter month instead of rolling over', () => {
    const jan31 = noon(2026, 0, 31);
    const result = navigateCalendarDate(jan31, 'PageDown');
    expect(result).not.toBeNull();
    const landed = new Date(result!);
    expect(landed.getFullYear()).toBe(2026);
    expect(landed.getMonth()).toBe(1); // February
    expect(landed.getDate()).toBe(28); // 2026 is not a leap year
  });

  it('clamps PageUp into a shorter month instead of rolling over', () => {
    const mar31 = noon(2026, 2, 31);
    const result = navigateCalendarDate(mar31, 'PageUp');
    expect(result).not.toBeNull();
    const landed = new Date(result!);
    expect(landed.getFullYear()).toBe(2026);
    expect(landed.getMonth()).toBe(1); // February
    expect(landed.getDate()).toBe(28);
  });

  it('moves one year with Shift+PageDown and Shift+PageUp', () => {
    const nextYear = navigateCalendarDate(base, 'PageDown', true);
    const prevYear = navigateCalendarDate(base, 'PageUp', true);
    expect(localDayKey(nextYear!)).toBe(localDayKey(noon(2027, 7, 26)));
    expect(localDayKey(prevYear!)).toBe(localDayKey(noon(2025, 7, 26)));
  });

  it('clamps a leap-day Shift+PageDown/PageUp landing in non-leap years', () => {
    const leapDay = noon(2028, 1, 29); // Feb 29, 2028 is a valid leap day
    const forward = navigateCalendarDate(leapDay, 'PageDown', true);
    const backward = navigateCalendarDate(leapDay, 'PageUp', true);
    expect(forward).not.toBeNull();
    expect(backward).not.toBeNull();

    const fwd = new Date(forward!);
    expect(fwd.getFullYear()).toBe(2029);
    expect(fwd.getMonth()).toBe(1); // February
    expect(fwd.getDate()).toBe(28); // 2029 is not a leap year

    const back = new Date(backward!);
    expect(back.getFullYear()).toBe(2027);
    expect(back.getMonth()).toBe(1); // February
    expect(back.getDate()).toBe(28); // 2027 is not a leap year
  });

  it('returns null for Enter and Space, leaving activation to the native click', () => {
    expect(navigateCalendarDate(base, 'Enter')).toBeNull();
    expect(navigateCalendarDate(base, ' ')).toBeNull();
  });

  it('returns null for unsupported keys', () => {
    expect(navigateCalendarDate(base, 'Tab')).toBeNull();
    expect(navigateCalendarDate(base, 'Escape')).toBeNull();
    expect(navigateCalendarDate(base, 'a')).toBeNull();
  });
});
