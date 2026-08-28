import type { ChangeEvent } from './types';

export interface ActivityDaySummary {
  key: string;
  timestamp: number;
  eventCount: number;
  fileCount: number;
  commitCount: number;
}

export interface CalendarDayCell {
  key: string;
  timestamp: number;
  dayNumber: number;
  inCurrentMonth: boolean;
  activity: ActivityDaySummary | null;
}

export function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function navigateCalendarDate(
  timestamp: number,
  key: string,
  shiftKey = false,
): number | null {
  const date = new Date(timestamp);
  date.setHours(12, 0, 0, 0);

  if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
    const offset = key === 'ArrowLeft' ? -1
      : key === 'ArrowRight' ? 1
        : key === 'ArrowUp' ? -7
          : 7;
    date.setDate(date.getDate() + offset);
    return date.getTime();
  }

  if (key === 'Home' || key === 'End') {
    const mondayOffset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() + (key === 'Home' ? -mondayOffset : 6 - mondayOffset));
    return date.getTime();
  }

  if (key === 'PageUp' || key === 'PageDown') {
    const direction = key === 'PageUp' ? -1 : 1;
    const monthOffset = direction * (shiftKey ? 12 : 1);
    const desiredDay = date.getDate();
    const target = new Date(date.getFullYear(), date.getMonth() + monthOffset, 1, 12);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
    target.setDate(Math.min(desiredDay, lastDay));
    return target.getTime();
  }

  return null;
}

export function summarizeActivityDays(events: ChangeEvent[]): Map<string, ActivityDaySummary> {
  const mutable = new Map<string, ActivityDaySummary & { paths: Set<string> }>();
  for (const event of events) {
    const key = localDayKey(event.ts);
    const existing = mutable.get(key) ?? {
      key,
      timestamp: event.ts,
      eventCount: 0,
      fileCount: 0,
      commitCount: 0,
      paths: new Set<string>(),
    };
    existing.timestamp = Math.max(existing.timestamp, event.ts);
    existing.eventCount += 1;
    if (event.path) existing.paths.add(event.path);
    if (event.op === 'commit') {
      existing.commitCount += 1;
      for (const path of event.commit?.paths ?? []) existing.paths.add(path);
    }
    mutable.set(key, existing);
  }

  const summaries = new Map<string, ActivityDaySummary>();
  for (const [key, summary] of mutable) {
    summaries.set(key, {
      key,
      timestamp: summary.timestamp,
      eventCount: summary.eventCount,
      fileCount: summary.paths.size,
      commitCount: summary.commitCount,
    });
  }
  return summaries;
}

/** Six complete Monday-first weeks keep the calendar layout stable across months. */
export function buildCalendarMonth(
  year: number,
  month: number,
  activityByDay: ReadonlyMap<string, ActivityDaySummary>,
): CalendarDayCell[] {
  const firstDay = new Date(year, month, 1, 12);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - mondayOffset, 12);
  const cells: CalendarDayCell[] = [];

  for (let offset = 0; offset < 42; offset += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + offset);
    const timestamp = date.getTime();
    const key = localDayKey(timestamp);
    cells.push({
      key,
      timestamp,
      dayNumber: date.getDate(),
      inCurrentMonth: date.getMonth() === month && date.getFullYear() === year,
      activity: activityByDay.get(key) ?? null,
    });
  }
  return cells;
}
