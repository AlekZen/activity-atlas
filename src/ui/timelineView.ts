import { ItemView, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import { buildCalendarMonth, localDayKey, navigateCalendarDate, summarizeActivityDays } from '../core/calendar';
import type { ActivityDaySummary } from '../core/calendar';
import type { ChangeEvent, ChangeOp } from '../core/types';
import { buildTimeline } from '../core/timeline';
import type { ActivityBurst, CoalescedChange, TimelineItem } from '../core/timeline';
import type { GitSnapshot } from '../git/types';

export const VIEW_TYPE_VAULT_PULSE = 'vault-pulse-timeline';

export interface TimelineDataSource {
  loadEvents(): Promise<ChangeEvent[]>;
  burstWindowMs(): number;
  loadGitSnapshot?(): Promise<GitSnapshot | null>;
  subscribe?(callback: () => void): () => void;
}

const OP_LABEL: Record<Exclude<ChangeOp, 'commit'>, string> = {
  create: 'Created',
  modify: 'Modified',
  delete: 'Deleted',
  rename: 'Renamed',
  resync: 'Reconciled',
};

const FILE_ICON_BY_EXTENSION: Record<string, string> = {
  md: 'file-text',
  markdown: 'file-text',
  txt: 'file-text',
  canvas: 'layout-dashboard',
  base: 'database',
  py: 'file-code-2',
  html: 'code-xml',
  htm: 'code-xml',
  xml: 'code-xml',
  css: 'palette',
  js: 'braces',
  mjs: 'braces',
  cjs: 'braces',
  ts: 'braces',
  json: 'file-json-2',
  yaml: 'list-tree',
  yml: 'list-tree',
  toml: 'list-tree',
  csv: 'table-2',
  pdf: 'file-text',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  mp3: 'audio-lines',
  wav: 'audio-lines',
  m4a: 'audio-lines',
  mp4: 'film',
  mov: 'film',
  webm: 'film',
  zip: 'archive',
  gz: 'archive',
  tar: 'archive',
  '7z': 'archive',
};

const CHANGES_PER_BURST = 80;

function fileIcon(path: string): string {
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return FILE_ICON_BY_EXTENSION[extension] ?? 'file';
}


function dayLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const formatted = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
  if (localDayKey(timestamp) === localDayKey(today.getTime())) return `Today · ${formatted}`;
  if (localDayKey(timestamp) === localDayKey(yesterday.getTime())) return `Yesterday · ${formatted}`;
  return formatted;
}

export class VaultPulseTimelineView extends ItemView {
  private events: ChangeEvent[] = [];
  private gitSnapshot: GitSnapshot | null = null;
  private activityDays = new Map<string, ActivityDaySummary>();
  private timelineEl!: HTMLElement;
  private statsEl!: HTMLElement;
  private calendarEl!: HTMLElement;
  private calendarButton!: HTMLButtonElement;
  private search = '';
  private operation = 'all';
  private extension = 'all';
  private gitState = 'all';
  private day = 'all';
  private calendarMonth = new Date();
  private calendarFocusDay = localDayKey(Date.now());
  private burstOpenState = new Map<string, boolean>();
  private visibleChangesByBurst = new Map<string, number>();
  private visibleItems = 120;
  private unsubscribe?: () => void;
  private refreshTimer: number | null = null;
  private searchRenderTimer: number | null = null;
  private refreshGeneration = 0;

  constructor(leaf: WorkspaceLeaf, private readonly source: TimelineDataSource) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_VAULT_PULSE;
  }

  getDisplayText(): string {
    return 'Vault Pulse';
  }

  getIcon(): string {
    return 'activity';
  }

  async onOpen(): Promise<void> {
    this.containerEl.empty();
    this.containerEl.addClass('vault-pulse-view');
    const root = this.containerEl.createDiv({ cls: 'vault-pulse' });
    this.renderHeader(root);
    this.renderControls(root);
    this.timelineEl = root.createDiv({ cls: 'vault-pulse__timeline', attr: { 'aria-live': 'polite' } });
    if (this.source.subscribe) this.unsubscribe = this.source.subscribe(() => this.scheduleRefresh());
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    if (this.searchRenderTimer !== null) window.clearTimeout(this.searchRenderTimer);
    this.searchRenderTimer = null;
    this.refreshTimer = null;
  }

  private renderHeader(root: HTMLElement): void {
    const header = root.createDiv({ cls: 'vault-pulse__header' });
    const identity = header.createDiv({ cls: 'vault-pulse__identity' });
    identity.createSpan({ cls: 'vault-pulse__live-dot', attr: { 'aria-hidden': 'true' } });
    const titleGroup = identity.createDiv();
    titleGroup.createEl('h2', { text: 'Vault Pulse' });
    titleGroup.createEl('p', { text: 'Live activity, grouped into readable bursts.' });
    this.statsEl = header.createDiv({ cls: 'vault-pulse__stats' });
  }

  private renderControls(root: HTMLElement): void {
    const controls = root.createDiv({ cls: 'vault-pulse__controls' });
    const search = controls.createEl('input', {
      cls: 'vault-pulse__search',
      attr: { type: 'search', placeholder: 'Filter by path…', 'aria-label': 'Filter activity by path' },
    });
    search.addEventListener('input', () => {
      this.search = search.value.trim().toLowerCase();
      this.visibleItems = 120;
      this.scheduleTimelineRender();
    });

    const dateFilter = controls.createDiv({ cls: 'vault-pulse__date-filter' });
    this.createSelect(dateFilter, 'Day', [['all', 'All days']], value => this.selectDay(value), 'day');
    this.calendarButton = dateFilter.createEl('button', {
      cls: 'clickable-icon vault-pulse__calendar-toggle',
      attr: {
        type: 'button',
        'aria-label': 'Open activity calendar',
        'aria-expanded': 'false',
        'aria-controls': 'vault-pulse-calendar',
      },
    });
    setIcon(this.calendarButton, 'calendar-days');
    this.calendarButton.addEventListener('click', () => this.toggleCalendar());
    this.calendarEl = dateFilter.createDiv({
      cls: 'vault-pulse__calendar is-hidden',
      attr: { id: 'vault-pulse-calendar' },
    });
    this.calendarEl.addEventListener('keydown', event => this.handleCalendarKeydown(event));

    this.createSelect(controls, 'Operation', [
      ['all', 'All changes'],
      ['create', 'Created'],
      ['modify', 'Modified'],
      ['rename', 'Renamed'],
      ['delete', 'Deleted'],
      ['resync', 'Reconciled'],
    ], value => {
      this.operation = value;
      this.renderTimeline();
    });
    this.createSelect(controls, 'Extension', [['all', 'All types']], value => {
      this.extension = value;
      this.renderTimeline();
    }, 'extension');
    this.createSelect(controls, 'Git state', [
      ['all', 'All Git states'],
      ['modified', 'Uncommitted'],
      ['staged', 'Staged'],
      ['staged-modified', 'Staged + modified'],
      ['untracked', 'Untracked'],
      ['ignored', 'Ignored'],
      ['clean', 'Committed / clean'],
    ], value => {
      this.gitState = value;
      this.renderTimeline();
    });

    const refreshButton = controls.createEl('button', {
      cls: 'clickable-icon vault-pulse__refresh',
      attr: { type: 'button', 'aria-label': 'Refresh activity' },
    });
    setIcon(refreshButton, 'refresh-cw');
    refreshButton.addEventListener('click', () => void this.refresh());

    const burstActions = controls.createDiv({ cls: 'vault-pulse__burst-actions' });
    const expandButton = burstActions.createEl('button', {
      text: 'Expand all',
      attr: { type: 'button', 'aria-label': 'Expand all activity bursts' },
    });
    expandButton.addEventListener('click', () => this.setAllBursts(true));
    const collapseButton = burstActions.createEl('button', {
      text: 'Collapse all',
      attr: { type: 'button', 'aria-label': 'Collapse all activity bursts' },
    });
    collapseButton.addEventListener('click', () => this.setAllBursts(false));
  }

  private createSelect(
    parent: HTMLElement,
    label: string,
    options: Array<[string, string]>,
    onChange: (value: string) => void,
    marker?: string,
  ): HTMLSelectElement {
    const select = parent.createEl('select', { attr: { 'aria-label': label } });
    if (marker) select.dataset.pulseSelect = marker;
    for (const [value, text] of options) select.createEl('option', { text, value });
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, 120);
  }

  private scheduleTimelineRender(): void {
    if (this.searchRenderTimer !== null) window.clearTimeout(this.searchRenderTimer);
    this.searchRenderTimer = window.setTimeout(() => {
      this.searchRenderTimer = null;
      this.renderTimeline();
    }, 80);
  }

  private async refresh(): Promise<void> {
    const generation = ++this.refreshGeneration;
    this.timelineEl?.addClass('is-loading');
    try {
      const [events, gitSnapshot] = await Promise.all([
        this.source.loadEvents(),
        this.source.loadGitSnapshot?.() ?? Promise.resolve(null),
      ]);
      if (generation !== this.refreshGeneration) return;
      this.events = events;
      this.gitSnapshot = gitSnapshot;
      this.activityDays = summarizeActivityDays(events);
      this.updateExtensionOptions();
      this.updateDayOptions();
      this.renderCalendar();
      this.renderTimeline();
    } catch (error) {
      if (generation !== this.refreshGeneration) return;
      this.timelineEl.empty();
      const state = this.timelineEl.createDiv({ cls: 'vault-pulse__empty' });
      state.createEl('strong', { text: 'Activity could not be loaded.' });
      state.createEl('span', { text: error instanceof Error ? error.message : String(error) });
    } finally {
      if (generation === this.refreshGeneration) this.timelineEl?.removeClass('is-loading');
    }
  }

  private updateExtensionOptions(): void {
    const select = this.containerEl.querySelector<HTMLSelectElement>('select[data-pulse-select="extension"]');
    if (!select) return;
    const current = select.value;
    const extensions = new Set<string>();
    for (const event of this.events) {
      if (!event.path || event.op === 'commit') continue;
      const name = event.path.split('/').pop() ?? '';
      const dot = name.lastIndexOf('.');
      extensions.add(dot >= 0 ? name.slice(dot + 1).toLowerCase() : '(none)');
    }
    select.empty();
    select.createEl('option', { text: 'All types', value: 'all' });
    for (const extension of [...extensions].sort()) {
      select.createEl('option', { text: extension === '(none)' ? 'No extension' : `.${extension}`, value: extension });
    }
    select.value = [...extensions, 'all'].includes(current) ? current : 'all';
    this.extension = select.value;
  }

  private updateDayOptions(): void {
    const select = this.containerEl.querySelector<HTMLSelectElement>('select[data-pulse-select="day"]');
    if (!select) return;
    const summaries = this.activityDays;
    const days = [...summaries.values()].sort((left, right) => right.key.localeCompare(left.key));
    select.empty();
    select.createEl('option', { text: 'All days', value: 'all' });
    for (const summary of days) {
      select.createEl('option', { text: dayLabel(summary.timestamp), value: summary.key });
    }
    select.value = summaries.has(this.day) ? this.day : 'all';
    this.day = select.value;
  }

  private calendarMonthBounds(): { earliest: number; current: number } {
    const summaryDates = [...this.activityDays.values()].map(summary => new Date(summary.timestamp));
    const now = new Date();
    const current = now.getFullYear() * 12 + now.getMonth();
    const earliest = summaryDates.length
      ? Math.min(...summaryDates.map(date => date.getFullYear() * 12 + date.getMonth()))
      : current;
    return { earliest, current };
  }

  private focusCalendarDay(): void {
    this.calendarEl
      .querySelector<HTMLButtonElement>(`button[data-pulse-day="${this.calendarFocusDay}"]`)
      ?.focus();
  }

  private handleCalendarKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.setCalendarOpen(false);
      this.calendarButton.focus();
      return;
    }

    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-pulse-day]');
    if (!button) return;
    const timestamp = Number(button.dataset.pulseTimestamp);
    const targetTimestamp = navigateCalendarDate(timestamp, event.key, event.shiftKey);
    if (targetTimestamp === null) return;
    event.preventDefault();
    event.stopPropagation();

    const target = new Date(targetTimestamp);
    const targetMonthIndex = target.getFullYear() * 12 + target.getMonth();
    const bounds = this.calendarMonthBounds();
    if (targetMonthIndex < bounds.earliest || targetMonthIndex > bounds.current) return;

    this.calendarFocusDay = localDayKey(targetTimestamp);
    this.calendarMonth = new Date(target.getFullYear(), target.getMonth(), 1, 12);
    this.renderCalendar();
    this.focusCalendarDay();
  }

  private setCalendarOpen(open: boolean): void {
    this.calendarEl.toggleClass('is-hidden', !open);
    this.calendarButton.setAttribute('aria-expanded', String(open));
    this.calendarButton.setAttribute('aria-label', open ? 'Close activity calendar' : 'Open activity calendar');
    if (!open) return;

    if (this.day !== 'all') {
      this.calendarFocusDay = this.day;
      const summary = this.activityDays.get(this.day);
      if (summary) this.calendarMonth = new Date(summary.timestamp);
    } else {
      const now = new Date();
      this.calendarFocusDay = localDayKey(now.getTime());
      this.calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1, 12);
    }
    this.renderCalendar();
    this.focusCalendarDay();
  }

  private toggleCalendar(): void {
    this.setCalendarOpen(this.calendarEl.hasClass('is-hidden'));
  }

  private selectDay(value: string, closeCalendar = false): void {
    this.day = value;
    this.visibleItems = 120;
    const select = this.containerEl.querySelector<HTMLSelectElement>('select[data-pulse-select="day"]');
    if (select) select.value = value;
    const summary = this.activityDays.get(value);
    if (summary) {
      this.calendarMonth = new Date(summary.timestamp);
      this.calendarFocusDay = value;
    }
    this.renderCalendar();
    this.renderTimeline();
    if (closeCalendar) this.setCalendarOpen(false);
  }

  private shiftCalendarMonth(offset: number): void {
    const year = this.calendarMonth.getFullYear();
    const month = this.calendarMonth.getMonth() + offset;
    const desiredDay = Number(this.calendarFocusDay.slice(-2)) || 1;
    const lastDay = new Date(year, month + 1, 0, 12).getDate();
    const target = new Date(year, month, Math.min(desiredDay, lastDay), 12);
    this.calendarMonth = new Date(target.getFullYear(), target.getMonth(), 1, 12);
    this.calendarFocusDay = localDayKey(target.getTime());
    this.renderCalendar();
    this.focusCalendarDay();
  }

  private renderCalendar(): void {
    if (!this.calendarEl) return;
    this.calendarEl.empty();
    const summaries = this.activityDays;
    const year = this.calendarMonth.getFullYear();
    const month = this.calendarMonth.getMonth();
    const cells = buildCalendarMonth(year, month, summaries);
    const currentMonthActivity = cells
      .filter(cell => cell.inCurrentMonth && cell.activity)
      .map(cell => cell.activity as ActivityDaySummary);
    const maxEvents = Math.max(1, ...currentMonthActivity.map(summary => summary.eventCount));
    const monthIndex = year * 12 + month;
    const bounds = this.calendarMonthBounds();
    if (!cells.some(cell => cell.key === this.calendarFocusDay)) {
      this.calendarFocusDay = localDayKey(new Date(year, month, 1, 12).getTime());
    }

    const header = this.calendarEl.createDiv({ cls: 'vault-pulse__calendar-header' });
    const previous = header.createEl('button', {
      cls: 'clickable-icon',
      attr: { type: 'button', 'aria-label': 'Previous month' },
    });
    setIcon(previous, 'chevron-left');
    previous.disabled = monthIndex <= bounds.earliest;
    previous.addEventListener('click', () => this.shiftCalendarMonth(-1));
    header.createEl('strong', {
      text: this.calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    });
    const next = header.createEl('button', {
      cls: 'clickable-icon',
      attr: { type: 'button', 'aria-label': 'Next month' },
    });
    setIcon(next, 'chevron-right');
    next.disabled = monthIndex >= bounds.current;
    next.addEventListener('click', () => this.shiftCalendarMonth(1));

    const weekdays = this.calendarEl.createDiv({
      cls: 'vault-pulse__calendar-weekdays',
      attr: { 'aria-hidden': 'true' },
    });
    const monday = new Date(2021, 2, 1, 12);
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + offset);
      weekdays.createSpan({ text: date.toLocaleDateString(undefined, { weekday: 'narrow' }) });
    }

    const grid = this.calendarEl.createDiv({
      cls: 'vault-pulse__calendar-grid',
      attr: { role: 'grid', 'aria-label': `Activity calendar, ${year}-${month + 1}` },
    });
    const todayKey = localDayKey(Date.now());
    for (const cell of cells) {
      const activity = cell.activity;
      const dateText = new Date(cell.timestamp).toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      const description = activity
        ? `${activity.eventCount} events across ${activity.fileCount} files`
        : 'No recorded activity';
      const button = grid.createEl('button', {
        cls: [
          'vault-pulse__calendar-day',
          cell.inCurrentMonth ? '' : 'is-outside',
          activity ? 'has-activity' : '',
          activity?.commitCount ? 'has-commit' : '',
          cell.key === this.day ? 'is-selected' : '',
          cell.key === todayKey ? 'is-today' : '',
        ].filter(Boolean).join(' '),
        attr: {
          type: 'button',
          role: 'gridcell',
          'aria-label': `${dateText}. ${description}.`,
          'aria-selected': String(cell.key === this.day),
          title: `${dateText} · ${description}`,
        },
      });
      button.dataset.pulseDay = cell.key;
      button.dataset.pulseTimestamp = String(cell.timestamp);
      button.tabIndex = cell.key === this.calendarFocusDay ? 0 : -1;
      button.setAttribute('aria-disabled', String(!activity));
      if (cell.key === todayKey) button.setAttribute('aria-current', 'date');
      button.createSpan({ cls: 'vault-pulse__calendar-number', text: String(cell.dayNumber) });
      if (activity) {
        const level = maxEvents <= 1
          ? 1
          : Math.max(1, Math.ceil((Math.log1p(activity.eventCount) / Math.log1p(maxEvents)) * 4));
        button.dataset.level = String(level);
        button.createSpan({ cls: 'vault-pulse__calendar-pulse', attr: { 'aria-hidden': 'true' } });
        button.addEventListener('click', () => this.selectDay(cell.key === this.day ? 'all' : cell.key, true));
      }
    }

    const eventCount = currentMonthActivity.reduce((total, summary) => total + summary.eventCount, 0);
    const footer = this.calendarEl.createDiv({ cls: 'vault-pulse__calendar-footer' });
    footer.createSpan({
      text: `${eventCount} ${eventCount === 1 ? 'event' : 'events'} · ${currentMonthActivity.length} active ${currentMonthActivity.length === 1 ? 'day' : 'days'}`,
    });
    const actions = footer.createDiv({ cls: 'vault-pulse__calendar-actions' });
    const today = actions.createEl('button', { text: 'Today', attr: { type: 'button' } });
    today.addEventListener('click', () => {
      const current = new Date();
      this.calendarMonth = new Date(current.getFullYear(), current.getMonth(), 1, 12);
      if (summaries.has(todayKey)) this.selectDay(todayKey, true);
      else this.renderCalendar();
    });
    const all = actions.createEl('button', {
      text: 'All activity',
      attr: { type: 'button', 'aria-pressed': String(this.day === 'all') },
    });
    all.addEventListener('click', () => this.selectDay('all', true));
  }

  private filteredEvents(): ChangeEvent[] {
    return this.events.filter(event => {
      if (this.day !== 'all' && localDayKey(event.ts) !== this.day) return false;
      if (event.op === 'commit') {
        const commitMatches = !this.search
          || event.commit?.subject.toLowerCase().includes(this.search)
          || event.commit?.author.toLowerCase().includes(this.search)
          || event.commit?.oid.toLowerCase().includes(this.search)
          || event.commit?.paths.some(path => path.toLowerCase().includes(this.search));
        return this.operation === 'all' && this.extension === 'all' && this.gitState === 'all' && commitMatches;
      }
      if (this.search && !event.path.toLowerCase().includes(this.search) && !(event.oldPath ?? '').toLowerCase().includes(this.search)) return false;
      if (this.operation !== 'all' && event.op !== this.operation) return false;
      if (this.extension !== 'all') {
        const name = event.path.split('/').pop() ?? '';
        const dot = name.lastIndexOf('.');
        const extension = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '(none)';
        if (extension !== this.extension) return false;
      }
      if (this.gitState !== 'all') {
        const state = this.gitSnapshot?.files[event.path]?.state ?? 'clean';
        if (state !== this.gitState) return false;
      }
      return true;
    });
  }

  private setAllBursts(open: boolean): void {
    const items = buildTimeline(this.filteredEvents(), this.source.burstWindowMs());
    for (const item of items) {
      if (item.kind === 'burst') this.burstOpenState.set(item.id, open);
    }
    this.renderTimeline();
  }

  private renderTimeline(): void {
    if (!this.timelineEl) return;
    this.timelineEl.empty();
    const filtered = this.filteredEvents();
    const items = buildTimeline(filtered, this.source.burstWindowMs());
    const visible = items.slice(0, this.visibleItems);
    const paths = new Set(filtered.map(event => event.path).filter(Boolean));
    const dirty = Object.keys(this.gitSnapshot?.files ?? {}).filter(path => this.gitSnapshot?.files[path].state !== 'ignored').length;
    this.statsEl.empty();
    this.statsEl.createSpan({ text: `${paths.size} files` });
    this.statsEl.createSpan({ text: `${items.filter(item => item.kind === 'burst').length} bursts` });
    if (this.gitSnapshot?.available) this.statsEl.createSpan({ text: `${dirty} uncommitted`, cls: dirty ? 'is-dirty' : 'is-clean' });

    if (visible.length === 0) {
      const empty = this.timelineEl.createDiv({ cls: 'vault-pulse__empty' });
      empty.createEl('strong', { text: this.events.length ? 'No activity matches these filters.' : 'Your vault is quiet.' });
      empty.createEl('span', { text: this.events.length ? 'Clear a filter to bring events back.' : 'Create, edit, rename, or delete a file to start the pulse.' });
      return;
    }

    let lastDay = '';
    const defaultOpenBurstId = visible.find(item => item.kind === 'burst')?.id;
    for (const item of visible) {
      const timestamp = item.kind === 'commit' ? item.ts : item.endTs;
      const day = new Date(timestamp).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      if (day !== lastDay) {
        this.timelineEl.createDiv({ cls: 'vault-pulse__day', text: day });
        lastDay = day;
      }
      if (item.kind === 'commit') this.renderCommit(item);
      else this.renderBurst(item, this.burstOpenState.get(item.id) ?? item.id === defaultOpenBurstId);
    }

    if (items.length > visible.length) {
      const more = this.timelineEl.createEl('button', { cls: 'vault-pulse__more', text: `Load ${Math.min(120, items.length - visible.length)} more` });
      more.addEventListener('click', () => {
        this.visibleItems += 120;
        this.renderTimeline();
      });
    }
  }

  private renderCommit(item: Extract<TimelineItem, { kind: 'commit' }>): void {
    const marker = this.timelineEl.createDiv({ cls: 'vault-pulse__commit' });
    marker.createSpan({ cls: 'vault-pulse__rail-dot', attr: { 'aria-hidden': 'true' } });
    const body = marker.createDiv();
    body.createDiv({ cls: 'vault-pulse__commit-title', text: item.commit.subject || 'Commit' });
    body.createDiv({ cls: 'vault-pulse__commit-meta', text: `${item.commit.shortOid} · ${item.commit.author} · ${item.commit.paths.length} files` });
  }

  private renderBurst(burst: ActivityBurst, open: boolean): void {
    const details = this.timelineEl.createEl('details', { cls: 'vault-pulse__burst' });
    details.open = open;
    details.createSpan({ cls: 'vault-pulse__rail-dot', attr: { 'aria-hidden': 'true' } });
    const summary = details.createEl('summary');
    const time = new Date(burst.endTs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const durationMinutes = Math.max(1, Math.ceil((burst.endTs - burst.startTs) / 60000));
    summary.createDiv({ cls: 'vault-pulse__burst-title', text: `${time} · ${burst.fileCount} ${burst.fileCount === 1 ? 'file' : 'files'}` });
    summary.createDiv({ cls: 'vault-pulse__burst-meta', text: `${burst.eventCount} events · ${durationMinutes} min` });
    const list = details.createDiv({ cls: 'vault-pulse__changes' });

    const renderChanges = (): void => {
      list.empty();
      const limit = this.visibleChangesByBurst.get(burst.id) ?? CHANGES_PER_BURST;
      for (const change of burst.changes.slice(0, limit)) this.renderChange(list, change);
      const remaining = burst.changes.length - limit;
      if (remaining <= 0) return;
      const nextCount = Math.min(CHANGES_PER_BURST, remaining);
      const more = list.createEl('button', {
        cls: 'vault-pulse__more vault-pulse__changes-more',
        text: `Show ${nextCount} more changes`,
        attr: { type: 'button' },
      });
      more.addEventListener('click', () => {
        this.visibleChangesByBurst.set(burst.id, limit + CHANGES_PER_BURST);
        renderChanges();
      });
    };

    if (open) renderChanges();
    details.addEventListener('toggle', () => {
      this.burstOpenState.set(burst.id, details.open);
      if (details.open && list.childElementCount === 0) renderChanges();
    });
  }

  private renderChange(parent: HTMLElement, change: CoalescedChange): void {
    const row = parent.createDiv({ cls: `vault-pulse__change is-${change.op}` });
    row.createSpan({ cls: 'vault-pulse__op-dot', attr: { 'aria-hidden': 'true' } });
    const main = row.createDiv({ cls: 'vault-pulse__change-main' });
    const file = this.app.vault.getAbstractFileByPath(change.path);
    const pathButton = main.createEl('button', {
      cls: 'vault-pulse__path',
      attr: { type: 'button' },
    });
    const icon = pathButton.createSpan({ cls: 'vault-pulse__file-icon', attr: { 'aria-hidden': 'true' } });
    setIcon(icon, fileIcon(change.path));
    pathButton.createSpan({ cls: 'vault-pulse__path-text', text: change.path || OP_LABEL[change.op] });
    pathButton.disabled = !(file instanceof TFile);
    if (file instanceof TFile) pathButton.addEventListener('click', () => void this.app.workspace.getLeaf(false).openFile(file));
    const detail = main.createDiv({ cls: 'vault-pulse__change-detail' });
    const operation = change.count > 1 ? `${OP_LABEL[change.op]} ×${change.count}` : OP_LABEL[change.op];
    detail.createSpan({ text: operation });
    if (change.oldPath) detail.createSpan({ text: `from ${change.oldPath}` });
    if (change.stat) detail.createSpan({ text: `+${change.stat.added} −${change.stat.removed}`, cls: 'vault-pulse__diff' });
    if (change.source === 'reconcile') detail.createSpan({ text: 'Recovered after restart', cls: 'vault-pulse__source' });

    const gitStatus = this.gitSnapshot?.files[change.path];
    const badge = row.createSpan({ cls: `vault-pulse__git is-${gitStatus?.state ?? 'clean'}` });
    badge.setText(gitStatus ? gitStatus.state.replace('-', ' + ') : 'committed / clean');
  }
}
